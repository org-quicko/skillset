import { z } from "zod";
import { timestamp } from "./timestamp.js";
import { SKILL_DESCRIPTION_MAX_LENGTH, SKILL_NAME_MAX_LENGTH, SKILL_NAME_PATTERN } from "./skill-rules.js";

/** Skills are listed 50 to a page, most recently published first. */
export const SKILL_PAGE_SIZE = 50;

export const SkillNameSchema = z.string().min(1).max(SKILL_NAME_MAX_LENGTH).regex(SKILL_NAME_PATTERN);

/**
 * Who last published a Skill. `email` is a snapshot taken at publish time and
 * survives the User being removed; the id and names are null once they are
 * (docs/data-model.md).
 */
export const PublisherSchema = z.object({
  user_id: z.string().nullable(),
  email: z.email(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
});
export type Publisher = z.infer<typeof PublisherSchema>;

export const SkillSummarySchema = z.object({
  name: SkillNameSchema,
  description: z.string().max(SKILL_DESCRIPTION_MAX_LENGTH),
  published_by: PublisherSchema,
  published_at: timestamp,
});
export type SkillSummary = z.infer<typeof SkillSummarySchema>;

/** A single Skill, with the `SKILL.md` body. Sanitise the body before rendering it. */
export const SkillSchema = SkillSummarySchema.extend({
  body: z.string(),
});
export type Skill = z.infer<typeof SkillSchema>;

export const SkillPageSchema = z.object({
  items: z.array(SkillSummarySchema),
  page: z.number().int(),
  page_size: z.literal(SKILL_PAGE_SIZE),
  total: z.number().int(),
});
export type SkillPage = z.infer<typeof SkillPageSchema>;

/** PUT /skills/\{name\} request body. The name comes from the path. */
export const SkillPublishSchema = z.object({
  description: z.string(),
  body: z.string(),
});
export type SkillPublish = z.infer<typeof SkillPublishSchema>;

/** Where the caller writes the Artifact. The bytes never pass through the API (ADR-0001). */
export const UploadTargetSchema = z.object({
  url: z.string(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
  expires_in_seconds: z.number().int(),
});
export type UploadTarget = z.infer<typeof UploadTargetSchema>;

export const SkillPublishedSchema = z.object({
  skill: SkillSchema,
  upload: UploadTargetSchema,
});
export type SkillPublished = z.infer<typeof SkillPublishedSchema>;
