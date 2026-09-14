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
