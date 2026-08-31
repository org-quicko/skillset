import { validateTagName, validateTagNames } from "@skill-registry/shared";
import { asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { isInvalidIdSyntax, isUniqueViolation } from "../db/pg-errors.js";
import { skillTags, skills, tags } from "../db/schemas/index.js";
import { SkillNotFoundError, TagNameConflictError, TagNotFoundError } from "../http/errors.js";
import type { Logger } from "../logger.js";

export interface TagSummary {
  id: string;
  name: string;
}

/** The Tag catalog, and the `skill_tags` join that attaches it to Skills (ADR-0011). */
export class TagsService {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  /**
   * Fetches the current Tags attached to a set of Skills, grouped by Skill id.
   *
   * @remarks
   * Every Skill read path (list, get, publish's response) calls this instead
   * of reading a `tags` column — a Skill's tags are always a join through
   * `skill_tags`, never stored redundantly on the Skill's own row (ADR-0011).
   * One query for however many Skill ids are passed, not one per Skill.
   *
   * @param skillIds - The Skill ids to fetch Tags for. An empty array
   * short-circuits to an empty map without a query.
   * @returns A map from Skill id to its Tags, alphabetical by name. A Skill id
   * with no Tags is simply absent from the map — callers should default to `[]`.
   * @example
   * ```ts
   * const bySkill = await tagsService.getTagsBySkillIds([id1, id2]);
   * const tagsForId1 = bySkill.get(id1) ?? [];
   * ```
   */
  async getTagsBySkillIds(skillIds: string[]): Promise<Map<string, TagSummary[]>> {
    if (skillIds.length === 0) return new Map();

    const rows = await this.db
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
   * @param skillId - The Skill's id.
   * @returns The Skill's Tags, alphabetical by name — `[]` if it has none.
   * @example
   * ```ts
   * const tags = await tagsService.getSkillTags(skillId);
   * ```
   */
  async getSkillTags(skillId: string): Promise<TagSummary[]> {
    const bySkill = await this.getTagsBySkillIds([skillId]);
    return bySkill.get(skillId) ?? [];
  }

  /**
   * Lists the whole Tag catalog, alphabetically by name — registry-wide, not
   * scoped to a Skill. A tag editor's autocomplete filters against this, so a
   * writer sees what exists before typing a near-duplicate (ADR-0011).
   */
  async list(): Promise<TagSummary[]> {
    return this.db.select({ id: tags.id, name: tags.name }).from(tags).orderBy(asc(tags.name));
  }

  /**
   * Replaces a Skill's Tags wholesale, by name.
   *
   * @remarks
   * A full replace: `rawNames` becomes exactly the Skill's Tags, and anything
   * absent is detached — never deleted from the catalog, since a Tag outlives
   * the Skills carrying it (ADR-0011).
   *
   * Each name resolves to a catalog row through an upsert, the only way a new
   * Tag comes into existence. The same-value `set` is required: Postgres
   * returns a row from `RETURNING` only on the branch it took. Race-free —
   * concurrent requests naming the same new Tag resolve to the one row the
   * unique constraint allows.
   *
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
   * const tags = await tagsService.setSkillTags(skillId, ["code-review", "ai"]);
   * ```
   */
  async setSkillTags(skillId: string, rawNames: unknown): Promise<TagSummary[]> {
    let skill: { id: string } | undefined;
    try {
      [skill] = await this.db.select({ id: skills.id }).from(skills).where(eq(skills.id, skillId)).limit(1);
    } catch (cause) {
      if (isInvalidIdSyntax(cause)) throw new SkillNotFoundError();
      throw cause;
    }
    if (!skill) throw new SkillNotFoundError();

    const names = validateTagNames(rawNames);

    const resolved = await this.db.transaction(async (tx) => {
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

    this.logger.info({ skill_id: skillId, tag_count: resolved.length }, "skill tags set");

    return resolved.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Renames a Tag in place.
   *
   * @remarks
   * Every Skill carrying this Tag picks up the new name: `skill_tags`
   * references it by `id`, so only `tags.name` changes (ADR-0011).
   *
   * Conflicts come from the unique constraint, not a check-then-write, so two
   * concurrent renames to the same name cannot both succeed.
   *
   * @param id - The Tag's id.
   * @param rawName - The candidate new name, typically a request body's
   * `name` field and not yet known to be a string.
   * @returns The renamed Tag.
   * @throws TagNotFoundError if `id` is not a well-formed UUID, or no Tag exists by it.
   * @throws TagValidationError if `rawName` fails validation.
   * @throws TagNameConflictError if the normalised name is already held by a different Tag.
   */
  async rename(id: string, rawName: unknown): Promise<TagSummary> {
    const name = validateTagName(rawName);

    let row: TagSummary | undefined;
    try {
      [row] = await this.db
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

    this.logger.info({ tag_id: id, name }, "tag renamed");

    return row;
  }
}
