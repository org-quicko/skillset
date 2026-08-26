import { z } from "zod";
import { TagSchema } from "./tag.js";
import { timestamp } from "./timestamp.js";
import { SKILL_DESCRIPTION_MAX_LENGTH, SKILL_NAME_MAX_LENGTH, SKILL_NAME_PATTERN } from "./skill-rules.js";

/** `GET /skills`'s `page_size`: client-supplied, defaults to 10, clamped rather than rejected outside this range. */
export const SKILL_DIRECTORY_DEFAULT_PAGE_SIZE = 10;
export const SKILL_DIRECTORY_MIN_PAGE_SIZE = 1;
export const SKILL_DIRECTORY_MAX_PAGE_SIZE = 100;

/** `GET /skills`'s `sort_by` — governs ordering unconditionally, even with `q` set (ticket 23). */
export const SKILL_DIRECTORY_SORT_FIELDS = ["installs", "updated_at"] as const;
export type SkillDirectorySortField = (typeof SKILL_DIRECTORY_SORT_FIELDS)[number];

/** `GET /skills`'s `sort_order`. */
export const SKILL_DIRECTORY_SORT_ORDERS = ["asc", "desc"] as const;
export type SkillDirectorySortOrder = (typeof SKILL_DIRECTORY_SORT_ORDERS)[number];

/**
 * Narrows a raw string to a valid `sort_by` value.
 *
 * @remarks
 * The one place this membership check is made — both the API's query-param
 * validation (`GET /skills`, rejecting anything else) and the web's
 * URL-state parsing (falling back to a default instead of rejecting) call
 * this rather than each re-deriving it from `SKILL_DIRECTORY_SORT_FIELDS`.
 *
 * @param value - The raw value to check, or `null`/`undefined` if absent.
 * @returns `true` if `value` is one of `SKILL_DIRECTORY_SORT_FIELDS`.
 * @example
 * ```ts
 * if (!isSkillDirectorySortField(raw)) throw new Error("invalid sort_by");
 * ```
 */
export function isSkillDirectorySortField(value: string | null | undefined): value is SkillDirectorySortField {
  return (SKILL_DIRECTORY_SORT_FIELDS as readonly string[]).includes(value ?? "");
}

/**
 * Narrows a raw string to a valid `sort_order` value.
 *
 * @remarks
 * The `sort_order` counterpart to `isSkillDirectorySortField` — see its
 * remarks for why this lives here rather than in each caller.
 *
 * @param value - The raw value to check, or `null`/`undefined` if absent.
 * @returns `true` if `value` is one of `SKILL_DIRECTORY_SORT_ORDERS`.
 * @example
 * ```ts
 * if (!isSkillDirectorySortOrder(raw)) throw new Error("invalid sort_order");
 * ```
 */
export function isSkillDirectorySortOrder(value: string | null | undefined): value is SkillDirectorySortOrder {
  return (SKILL_DIRECTORY_SORT_ORDERS as readonly string[]).includes(value ?? "");
}

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

/**
 * The four optional Agent Skills spec fields the Registry keeps, plus
 * `tags` — the catalog Tags currently attached to this Skill (registry
 * metadata, never written into `SKILL.md` itself — see
 * docs/adr/0008-tags-are-registry-metadata-not-frontmatter.md). Each of the
 * four is `null` when the Skill's frontmatter never set it, or set it to
 * something that failed validation and was therefore rejected at publish
 * time rather than stored.
 */
export const SkillFrontmatterExtrasSchema = z.object({
  license: z.string().nullable(),
  compatibility: z.string().nullable(),
  metadata: z.record(z.string(), z.string()).nullable(),
  allowed_tools: z.string().nullable(),
  tags: z.array(TagSchema),
});

export const SkillSummarySchema = z
  .object({
    id: z.string(),
    name: SkillNameSchema,
    description: z.string().max(SKILL_DESCRIPTION_MAX_LENGTH),
    published_by: PublisherSchema,
    published_at: timestamp,
    // Never negative, never absent: 0 until this Skill's first recorded
    // Install. Reflects the last periodic refresh of skill_analytics, not
    // necessarily every Install recorded so far (ADR-0012).
    installs: z.number().int().nonnegative(),
  })
  .extend(SkillFrontmatterExtrasSchema.shape);
export type SkillSummary = z.infer<typeof SkillSummarySchema>;

/** A single Skill, with the `SKILL.md` body. Sanitise the body before rendering it. */
export const SkillSchema = SkillSummarySchema.extend({
  body: z.string(),
});
export type Skill = z.infer<typeof SkillSchema>;

/**
 * One row of `GET /skills` (ticket 23) — deliberately not `SkillSummarySchema`:
 * the list is sourced from the `skill_directory` view (ADR-0012, docs/data-model.md),
 * which trades the full `Publisher` object for a `published_by_name` snapshot
 * and `published_at` for `updated_at`. `GET /skills/{id}` and `by-name/{name}`
 * are untouched — they still return `SkillSchema`.
 */
export const SkillDirectoryEntrySchema = z.object({
  id: z.string(),
  name: SkillNameSchema,
  description: z.string().max(SKILL_DESCRIPTION_MAX_LENGTH),
  published_by_name: z.string(),
  updated_at: timestamp,
  // Same lag caveat as SkillSummarySchema's `installs` (ADR-0012).
  installs: z.number().int().nonnegative(),
  tags: z.array(TagSchema),
});
export type SkillDirectoryEntry = z.infer<typeof SkillDirectoryEntrySchema>;

export const SkillDirectoryPageSchema = z.object({
  items: z.array(SkillDirectoryEntrySchema),
  page: z.number().int(),
  page_size: z.number().int().min(SKILL_DIRECTORY_MIN_PAGE_SIZE).max(SKILL_DIRECTORY_MAX_PAGE_SIZE),
  total: z.number().int(),
});
export type SkillDirectoryPage = z.infer<typeof SkillDirectoryPageSchema>;

/**
 * PUT /skills/\{name\} request body. The name comes from the path. The four
 * frontmatter extras are optional and unvalidated at this layer — the
 * shared validation rules (`validateSkillLicense` and friends) are what
 * actually enforce the specification, the same way `description` and
 * `body` are not length-checked here either. `tags` is deliberately absent:
 * publishing never sets it (docs/adr/0008) — see `PUT /skills/{id}/tags`
 * (`SetSkillTagsSchema`) instead.
 */
export const SkillPublishSchema = z.object({
  description: z.string(),
  body: z.string(),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  allowed_tools: z.string().optional(),
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

/**
 * The `Accept: application/json` representation of `GET /skills/{id}/artifact`
 * — the Skill itself, alongside `url` to actually fetch the Artifact from.
 * For a caller that needs to know the request succeeded before navigating
 * there itself: the ordinary representation is a 302 redirect, which a
 * plain link follows on its own but gives no such signal. Requesting either
 * representation counts as one Install; this doesn't record a second one.
 * `installs` on the returned Skill reflects the last periodic refresh, not
 * necessarily this request's own Install (ADR-0012).
 */
export const SkillWithArtifactUrlSchema = SkillSchema.extend({
  url: z.string(),
});
export type SkillWithArtifactUrl = z.infer<typeof SkillWithArtifactUrlSchema>;

export const SkillPublishedSchema = z.object({
  skill: SkillSchema,
  upload: UploadTargetSchema,
});
export type SkillPublished = z.infer<typeof SkillPublishedSchema>;
