import { validateTagName, validateTagNames } from "@skill-registry/shared";
import { asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { skillTags, skills, tags } from "../db/schema.js";
import { SkillNotFoundError, TagNameConflictError, TagNotFoundError } from "../http/errors.js";
import type { Logger } from "../logger.js";

export interface TagsServiceDependencies {
  db: Database;
  logger: Logger;
}

export interface TagSummary {
  id: string;
  name: string;
}

/** Postgres's unique_violation code — raised here only by `tags.name`'s unique constraint. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

/**
 * Postgres's invalid_text_representation code — raised for a malformed
 * `uuid` literal. A malformed id can never match a row, so this is caught
 * at the query rather than pre-validated: letting Postgres itself reject
 * the format means there's no separate format check to keep in sync with
 * what the database actually accepts.
 */
function isInvalidIdSyntax(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "22P02";
}

/**
 * Fetches the current Tags attached to a set of Skills, grouped by Skill id.
 *
 * @remarks
 * Every Skill read path (list, get, publish's response) calls this instead
 * of reading a `tags` column — a Skill's tags are always a join through
 * `skill_tags`, never stored redundantly on the Skill's own row (ADR-0011).
 * One query for however many Skill ids are passed, not one per Skill.
 *
 * @param deps - The database this reads from.
 * @param skillIds - The Skill ids to fetch Tags for. An empty array
 * short-circuits to an empty map without a query.
 * @returns A map from Skill id to its Tags, alphabetical by name. A Skill id
 * with no Tags is simply absent from the map — callers should default to `[]`.
 * @example
 * ```ts
 * const bySkill = await getTagsBySkillIds(deps, [id1, id2]);
 * const tagsForId1 = bySkill.get(id1) ?? [];
 * ```
 */
export async function getTagsBySkillIds(
  deps: Pick<TagsServiceDependencies, "db">,
  skillIds: string[],
): Promise<Map<string, TagSummary[]>> {
  if (skillIds.length === 0) return new Map();

  const rows = await deps.db
    .select({ skill_id: skillTags.skill_id, id: tags.id, name: tags.name })
    .from(skillTags)
    .innerJoin(tags, eq(skillTags.tag_id, tags.id))
    .where(inArray(skillTags.skill_id, skillIds))
    .orderBy(asc(tags.name));

  const bySkill = new Map<string, TagSummary[]>();
  for (const row of rows) {
    const forSkill = bySkill.get(row.skill_id) ?? [];
    forSkill.push({ id: row.id, name: row.name });
    bySkill.set(row.skill_id, forSkill);
  }
  return bySkill;
}

/**
 * Fetches one Skill's current Tags.
 *
 * @remarks
 * The single-Skill counterpart to `getTagsBySkillIds`, for the read paths
 * (`getSkill`, `getSkillByName`, `publishSkill`'s response) that only ever
 * need one Skill's Tags rather than a page of them — callers no longer have
 * to unwrap a one-entry map themselves.
 *
 * @param deps - The database this reads from.
 * @param skillId - The Skill's id.
 * @returns The Skill's Tags, alphabetical by name — `[]` if it has none.
 * @example
 * ```ts
 * const tags = await getSkillTags(deps, skillId);
 * ```
 */
export async function getSkillTags(deps: Pick<TagsServiceDependencies, "db">, skillId: string): Promise<TagSummary[]> {
  const bySkill = await getTagsBySkillIds(deps, [skillId]);
  return bySkill.get(skillId) ?? [];
}

/**
 * Lists the whole Tag catalog, alphabetically by name.
 *
 * @remarks
 * Registry-wide, not scoped to any one Skill — the source a tag editor's
 * autocomplete filters against, so a writer sees what already exists before
 * typing a near-duplicate (ADR-0011).
 *
 * @param deps - The database this reads from.
 * @returns Every Tag in the catalog.
 */
export async function listTags(deps: TagsServiceDependencies): Promise<TagSummary[]> {
  return deps.db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .orderBy(asc(tags.name));
}

/**
 * Replaces a Skill's Tags wholesale, by name.
 *
 * @remarks
 * A full replace, not an incremental add/remove: the resolved set of
 * `rawNames` becomes exactly the Skill's Tags, and any Tag it previously
 * carried that isn't in the list is detached — but never deleted from the
 * catalog itself, since a Tag can outlive every Skill that once carried it
 * (ADR-0011). Each name is validated and normalised (`validateTagName`),
 * then resolved to an existing catalog row or a newly created one via a
 * real upsert (`onConflictDoUpdate` with a same-value `set`, since Postgres
 * only returns a row from `RETURNING` on the branch it actually took) — this
 * "find-or-create" is the only way a brand new Tag ever comes into
 * existence, and it's race-free: two concurrent requests naming the same
 * new Tag both resolve to the one row Postgres's unique constraint allows.
 *
 * @param deps - The database and logger this needs.
 * @param skillId - The Skill's id.
 * @param rawNames - The full desired set of tag names, typically a request
 * body's `tags` field and not yet known to be an array.
 * @returns The Skill's resolved Tags, alphabetical by name.
 * @throws SkillNotFoundError if `skillId` is not a well-formed UUID, or no
 * Skill exists by it.
 * @throws TagValidationError if `rawNames` isn't an array, or any element
 * fails validation.
 * @example
 * ```ts
 * const tags = await setSkillTags(deps, skillId, ["code-review", "ai"]);
 * ```
 */
export async function setSkillTags(
  deps: TagsServiceDependencies,
  skillId: string,
  rawNames: unknown,
): Promise<TagSummary[]> {
  let skill: { id: string } | undefined;
  try {
    [skill] = await deps.db.select({ id: skills.id }).from(skills).where(eq(skills.id, skillId)).limit(1);
  } catch (cause) {
    if (isInvalidIdSyntax(cause)) throw new SkillNotFoundError();
    throw cause;
  }
  if (!skill) throw new SkillNotFoundError();

  const names = validateTagNames(rawNames);

  const resolved = await deps.db.transaction(async (tx) => {
    const resolvedTags: TagSummary[] = [];
    for (const name of names) {
      const [row] = await tx
        .insert(tags)
        .values({ name })
        .onConflictDoUpdate({ target: tags.name, set: { name, updated_at: new Date() } })
        .returning({ id: tags.id, name: tags.name });
      if (!row) throw new Error("Upsert did not return the Tag.");
      resolvedTags.push(row);
    }

    await tx.delete(skillTags).where(eq(skillTags.skill_id, skillId));
    if (resolvedTags.length > 0) {
      await tx.insert(skillTags).values(resolvedTags.map((tag) => ({ skill_id: skillId, tag_id: tag.id })));
    }

    return resolvedTags;
  });

  deps.logger.info({ skill_id: skillId, tag_count: resolved.length }, "skill tags set");

  return resolved.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Renames a Tag in place.
 *
 * @remarks
 * Every Skill referencing this Tag picks up the new name automatically —
 * nothing but the `tags.name` column changes, since every `skill_tags` row
 * references it by `id` (ADR-0011). Conflict detection relies on the
 * database's own unique constraint rather than a check-then-write, so two
 * concurrent renames to the same name can't both "succeed" — the second one
 * to reach Postgres gets the constraint violation, converted to a clean 409
 * rather than a raw database error.
 *
 * @param deps - The database and logger this needs.
 * @param id - The Tag's id.
 * @param rawName - The candidate new name, typically a request body's
 * `name` field and not yet known to be a string.
 * @returns The renamed Tag.
 * @throws TagNotFoundError if `id` is not a well-formed UUID, or no Tag exists by it.
 * @throws TagValidationError if `rawName` fails validation.
 * @throws TagNameConflictError if the normalised name is already held by a different Tag.
 */
export async function renameTag(deps: TagsServiceDependencies, id: string, rawName: unknown): Promise<TagSummary> {
  const name = validateTagName(rawName);

  let row: TagSummary | undefined;
  try {
    [row] = await deps.db
      .update(tags)
      .set({ name, updated_at: new Date() })
      .where(eq(tags.id, id))
      .returning({ id: tags.id, name: tags.name });
  } catch (cause) {
    if (isInvalidIdSyntax(cause)) throw new TagNotFoundError();
    if (isUniqueViolation(cause)) throw new TagNameConflictError();
    throw cause;
  }
  if (!row) throw new TagNotFoundError();

  deps.logger.info({ tag_id: id, name }, "tag renamed");

  return row;
}
