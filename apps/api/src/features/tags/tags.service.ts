import { asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { firstRow } from "../../db/rows.js";
import { isUniqueViolation } from "../../db/pg-errors.js";
import { resourceTags, resources, tags } from "../../db/schemas/index.js";
import type { Logger } from "../../lib/logger.js";
import { ResourceNotFoundError } from "../resources/resources.errors.js";
import { TagNameConflictError, TagNotFoundError } from "./tags.errors.js";

export interface TagSummary {
  id: string;
  name: string;
}

/** The Tag catalog, and the `resource_tags` join that attaches it to Skills (ADR-0011). */
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
   * `resource_tags`, never stored redundantly on the Skill's own row (ADR-0011).
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
      .select({ resource_id: resourceTags.resource_id, id: tags.id, name: tags.name })
      .from(resourceTags)
      .innerJoin(tags, eq(resourceTags.tag_id, tags.id))
      .where(inArray(resourceTags.resource_id, skillIds))
      .orderBy(asc(tags.name));

    const bySkill = new Map<string, TagSummary[]>();
    for (const row of rows) {
      const forSkill = bySkill.get(row.resource_id) ?? [];
      forSkill.push({ id: row.id, name: row.name });
      bySkill.set(row.resource_id, forSkill);
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
   * A full replace: `names` becomes exactly the Skill's Tags, and anything
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
   * @param names - The full desired set of Tag names, already held to
   * `validateTagNames`.
   * @returns The Skill's resolved Tags, alphabetical by name.
   * @throws ResourceNotFoundError if no Skill exists by `skillId`.
   * @example
   * ```ts
   * const tags = await tagsService.setSkillTags(skillId, ["code-review", "ai"]);
   * ```
   */
  async setSkillTags(skillId: string, names: readonly string[]): Promise<TagSummary[]> {
    const [skill] = await this.db.select({ id: resources.id }).from(resources).where(eq(resources.id, skillId)).limit(1);
    if (!skill) throw new ResourceNotFoundError();

    const resolved = await this.db.transaction(async (tx) => {
      const resolvedTags: TagSummary[] = [];
      for (const name of names) {
        const upserted = await tx
          .insert(tags)
          .values({ name })
          .onConflictDoUpdate({ target: tags.name, set: { name, updated_at: new Date() } })
          .returning({ id: tags.id, name: tags.name });
        resolvedTags.push(firstRow(upserted, "Tag upsert"));
      }

      await tx.delete(resourceTags).where(eq(resourceTags.resource_id, skillId));
      if (resolvedTags.length > 0) {
        await tx.insert(resourceTags).values(resolvedTags.map((tag) => ({ resource_id: skillId, tag_id: tag.id })));
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
   * Every Skill carrying this Tag picks up the new name: `resource_tags`
   * references it by `id`, so only `tags.name` changes (ADR-0011).
   *
   * Conflicts come from the unique constraint, not a check-then-write, so two
   * concurrent renames to the same name cannot both succeed.
   *
   * @param id - The Tag's id.
   * @param name - The new name, already held to `validateTagName`.
   * @returns The renamed Tag.
   * @throws TagNotFoundError if no Tag exists by `id`.
   * @throws TagNameConflictError if the normalised name is already held by a different Tag.
   * @example
   * ```ts
   * const tag = await tagsService.rename(tagId, "code-review");
   * ```
   */
  async rename(id: string, name: string): Promise<TagSummary> {
    let row: TagSummary | undefined;
    try {
      [row] = await this.db
        .update(tags)
        .set({ name, updated_at: new Date() })
        .where(eq(tags.id, id))
        .returning({ id: tags.id, name: tags.name });
    } catch (cause) {
      if (isUniqueViolation(cause)) throw new TagNameConflictError();
      throw cause;
    }
    if (!row) throw new TagNotFoundError();

    this.logger.info({ tag_id: id, name }, "tag renamed");

    return row;
  }
}
