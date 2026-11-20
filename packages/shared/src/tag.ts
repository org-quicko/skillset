import { z } from "zod";
import { TAG_NAME_MAX_LENGTH, TAG_NAME_PATTERN } from "./tag-rules.js";

export const TagNameSchema = z.string().min(1).max(TAG_NAME_MAX_LENGTH).regex(TAG_NAME_PATTERN);

/**
 * A catalog Tag: a stable `id` plus its current `name`, shared by every
 * Skill that carries it — renaming one (`PATCH /tags/{id}`) is visible
 * everywhere it's attached, since every reference is by `id`, not `name`.
 */
export const TagSchema = z.object({
  id: z.string(),
  name: TagNameSchema,
});
export type Tag = z.infer<typeof TagSchema>;

/** `GET /tags` response — the whole catalog, for the tag editor's autocomplete. */
export const TagListSchema = z.object({
  items: z.array(TagSchema),
});
export type TagList = z.infer<typeof TagListSchema>;

/**
 * Resolves a Tag's name to its id, against the whole catalog.
 *
 * @remarks
 * `tag_id` is what `GET /resources` filters on, and an id is not something a
 * person types or an Agent can come by — nothing either of them calls hands
 * one back. Both the CLI and the MCP server therefore take a name and resolve
 * it here, sharing this function rather than the fetch: how the catalog is
 * read differs between them, what a miss should say does not.
 *
 * Matched against the normalised form, since a Tag's name is lower-case by
 * rule (`validateTagName`) and a caller typing `Testing` means `testing`.
 *
 * @param tags - The whole Tag catalog, as `GET /tags` returns it.
 * @param name - The name to resolve.
 * @returns The matching Tag's id.
 * @throws Error naming every Tag that does exist when there is no match — a
 * caller who guessed wrong cannot guess better without the list, so the
 * refusal carries it rather than costing them a second call.
 * @example
 * ```ts
 * resolveTagIdByName([{ id: "018f…", name: "testing" }], "Testing"); // -> "018f…"
 * ```
 */
export function resolveTagIdByName(tags: readonly Tag[], name: string): string {
  const wanted = name.trim().toLowerCase();
  const match = tags.find((tag) => tag.name === wanted);
  if (match) return match.id;

  const known = tags.map((tag) => tag.name).join(", ");
  throw new Error(
    `No Tag named "${name}". ${known ? `Available Tags: ${known}.` : "This Registry has no Tags yet."}`,
  );
}

/**
 * `PUT /skills/\{id\}/tags` request body — a full replacement of the Skill's
 * tags, by name. The server resolves each name to an existing catalog row
 * or creates one (docs/adr — tags are a catalog, not a per-Skill list).
 */
export const SetSkillTagsSchema = z.object({
  tags: z.array(TagNameSchema),
});
export type SetSkillTags = z.infer<typeof SetSkillTagsSchema>;

/** `PUT /skills/\{id\}/tags` response — the Skill's resolved Tags after the replace. */
export const SkillTagsSchema = z.object({
  tags: z.array(TagSchema),
});
export type SkillTags = z.infer<typeof SkillTagsSchema>;

/** `PATCH /tags/\{id\}` request body. */
export const RenameTagSchema = z.object({
  name: TagNameSchema,
});
export type RenameTag = z.infer<typeof RenameTagSchema>;
