import type { Database } from "../../db/client.js";
import { isUniqueViolation } from "../../db/pg-errors.js";
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
      .selectFrom("resource_tags")
      .innerJoin("tags", "tags.id", "resource_tags.tag_id")
      .select(["resource_tags.resource_id", "tags.id", "tags.name"])
      .where("resource_tags.resource_id", "in", skillIds)
      .orderBy("tags.name")
      .execute();

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
    return this.db.selectFrom("tags").select(["id", "name"]).orderBy("name").execute();
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
    const skill = await this.db.selectFrom("resources").select("id").where("id", "=", skillId).executeTakeFirst();
    if (!skill) throw new ResourceNotFoundError();

    const resolved = await this.db.transaction().execute(async (tx) => {
      const resolvedTags: TagSummary[] = [];
      for (const name of names) {
        const upserted = await tx
          .insertInto("tags")
          .values({ name })
          .onConflict((oc) => oc.column("name").doUpdateSet({ name, updated_at: new Date() }))
          .returning(["id", "name"])
          .executeTakeFirstOrThrow();
        resolvedTags.push(upserted);
      }

      await tx.deleteFrom("resource_tags").where("resource_id", "=", skillId).execute();
      if (resolvedTags.length > 0) {
        await tx
          .insertInto("resource_tags")
          .values(resolvedTags.map((tag) => ({ resource_id: skillId, tag_id: tag.id })))
          .execute();
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
      row = await this.db
        .updateTable("tags")
        .set({ name, updated_at: new Date() })
        .where("id", "=", id)
        .returning(["id", "name"])
        .executeTakeFirst();
    } catch (cause) {
      if (isUniqueViolation(cause)) throw new TagNameConflictError();
      throw cause;
    }
    if (!row) throw new TagNotFoundError();

    this.logger.info({ tag_id: id, name }, "tag renamed");

    return row;
  }
}
