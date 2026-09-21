import { z } from "zod";
import { TagSchema } from "./tag.js";
import { timestamp } from "./timestamp.js";
import { SKILL_DESCRIPTION_MAX_LENGTH, SKILL_NAME_MAX_LENGTH, SKILL_NAME_PATTERN } from "./skill-rules.js";

/** `GET /resources`'s `page_size`: client-supplied, defaults to 10, clamped rather than rejected outside this range. */
export const SKILL_DIRECTORY_DEFAULT_PAGE_SIZE = 10;
export const SKILL_DIRECTORY_MIN_PAGE_SIZE = 1;
export const SKILL_DIRECTORY_MAX_PAGE_SIZE = 100;

/**
 * `GET /resources`'s `sort_by`.
 *
 * @remarks
 * `relevance` orders by how well a Resource matches `q`, and means nothing
 * without one — asking for it with no search term sorts by `updated_at`
 * instead of refusing, since a reader who clears the search box should keep
 * seeing a list. It is also the default whenever `q` is set; `updated_at`
 * remains the default when it is not (ADR-0028).
 */
export const SKILL_DIRECTORY_SORT_FIELDS = ["installs", "updated_at", "relevance"] as const;
export type SkillDirectorySortField = (typeof SKILL_DIRECTORY_SORT_FIELDS)[number];

/** `GET /resources`'s `sort_order`. */
export const SKILL_DIRECTORY_SORT_ORDERS = ["asc", "desc"] as const;
export type SkillDirectorySortOrder = (typeof SKILL_DIRECTORY_SORT_ORDERS)[number];

/**
 * Narrows a raw string to a valid `sort_by` value.
 *
 * @remarks
 * The one place this membership check is made — both the API's query-param
 * validation (`GET /resources`, rejecting anything else) and the web's
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
 * The `sort_by` that applies when a caller named none.
 *
 * @param q - The search term, if any. Blank or whitespace-only counts as
 * none, the same way `GET /resources` treats it.
 * @returns `relevance` when there is a term to rank against, `updated_at`
 * otherwise (ADR-0028).
 * @example
 * ```ts
 * defaultSkillDirectorySortField("adapter"); // -> "relevance"
 * defaultSkillDirectorySortField("");        // -> "updated_at"
 * ```
 */
export function defaultSkillDirectorySortField(q: string | null | undefined): SkillDirectorySortField {
  return q && q.trim() ? "relevance" : "updated_at";
}

/**
 * Settles a `sort_by` against whether there is a search term to rank on.
 *
 * @remarks
 * Two rules, inverses of each other: an omitted `sort_by` takes the default
 * for the term, and an explicit `relevance` with no term falls back to
 * `updated_at` rather than refusing — a reader who clears the search box
 * should keep their list, not receive an error for a parameter they never
 * typed.
 *
 * Shared because both surfaces need the identical rule and would otherwise
 * disagree: the API resolves it out of the query string, and the web
 * resolves it out of its own URL state and then sends the result back. A web
 * default that differed from the API's would make a shared link render
 * differently from the page it was copied from.
 *
 * @param sortBy - The caller's choice, or `undefined` when absent or
 * unrecognised.
 * @param q - The search term, if any.
 * @returns The `sort_by` to actually order by.
 * @example
 * ```ts
 * resolveSkillDirectorySortField(undefined, "adapter");  // -> "relevance"
 * resolveSkillDirectorySortField("relevance", "");       // -> "updated_at"
 * resolveSkillDirectorySortField("installs", "adapter"); // -> "installs"
 * ```
 */
export function resolveSkillDirectorySortField(
  sortBy: SkillDirectorySortField | undefined,
  q: string | null | undefined,
): SkillDirectorySortField {
  if (sortBy === undefined) return defaultSkillDirectorySortField(q);
  if (sortBy === "relevance") return defaultSkillDirectorySortField(q);
  return sortBy;
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

/**
 * A Skill's `resources.payload` (ADR-0026) — the four optional Agent Skills
 * spec fields, the same as `SkillFrontmatterExtrasSchema` minus `tags`, since
 * Tags are registry metadata rather than part of any Kind's own payload
 * (ADR-0008, ADR-0011). Each key is always present; a publish that doesn't
 * set a field stores `null` for it rather than omitting the key, matching the
 * full-replace semantics `description` and `body` already have (ADR-0002).
 */
export const SkillPayloadSchema = z.object({
  kind: z.literal("skill"),
  license: z.string().nullable(),
  compatibility: z.string().nullable(),
  metadata: z.record(z.string(), z.string()).nullable(),
  allowed_tools: z.string().nullable(),
});
export type SkillPayload = z.infer<typeof SkillPayloadSchema>;

export const SkillSummarySchema = z
  .object({
    id: z.string(),
    // Always "skill": this is SkillSchema's own literal, not the generic
    // `kind: z.string()` a future multi-Kind read would need (ADR-0026).
    kind: z.literal("skill"),
    name: SkillNameSchema,
    description: z.string().max(SKILL_DESCRIPTION_MAX_LENGTH),
    published_by: PublisherSchema,
    published_at: timestamp,
    // Moves on every republish, which `published_at` does not — so this is
    // the field a client stores at install time and compares against later
    // to tell whether its copy has gone stale. Without versioning (ADR-0002)
    // it is the only revision signal there is.
    updated_at: timestamp,
    // Never negative, never absent: 0 until this Skill's first recorded
    // Install. Reflects the last periodic refresh of resource_analytics, not
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
 * One row of `GET /resources` (ticket 23, ADR-0026) — deliberately not
 * `SkillSummarySchema`: the list is sourced from the `resource_directory` view
 * (ADR-0012, docs/data-model.md), which trades the full `Publisher` object for
 * a `published_by_name` snapshot and `published_at` for `updated_at`.
 * `GET /resources/{id}` and `{kind}/by-name/{name}` are untouched — they still
 * return `SkillSchema`.
 *
 * `kind` is a plain string here, not `z.literal("skill")`: the catalog lists
 * every Kind, and this is the one shape that's genuinely Kind-agnostic today,
 * even though `skill` is the only value it can hold until a second Kind
 * exists (ADR-0026).
 */
export const SkillDirectoryEntrySchema = z.object({
  id: z.string(),
  kind: z.string(),
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
 * Registry-wide counts for the Skill directory's hero stats: how many
 * Skills exist, how many distinct Publishers have published one, and how
 * many Installs have been recorded in total. Unfiltered — unaffected by any
 * search term or Tag selection, unlike `SkillDirectoryPage.total`.
 * `installs` carries the same periodic-refresh lag as every other install
 * count (ADR-0012).
 */
export const SkillDirectoryStatsSchema = z.object({
  skills: z.number().int().nonnegative(),
  publishers: z.number().int().nonnegative(),
  installs: z.number().int().nonnegative(),
});
export type SkillDirectoryStats = z.infer<typeof SkillDirectoryStatsSchema>;

/** One day of `SkillInstallTrendSchema` — `date` is `YYYY-MM-DD`, UTC. */
export const SkillInstallTrendPointSchema = z.object({
  date: z.string(),
  count: z.number().int().nonnegative(),
});
export type SkillInstallTrendPoint = z.infer<typeof SkillInstallTrendPointSchema>;

/** `GET /resources/{id}/installs/trend`: a Skill's daily Install counts over a fixed trailing window, oldest first. */
export const SkillInstallTrendSchema = z.object({
  points: z.array(SkillInstallTrendPointSchema),
});
export type SkillInstallTrend = z.infer<typeof SkillInstallTrendSchema>;

/**
 * One file of an Artifact, as the wire names it: a path relative to the
 * Skill's root and the size of its bytes. No content — an Artifact's bytes
 * go straight to and from object storage, never through this schema.
 *
 * It serves two directions. Publishing sends it as the *declared* manifest,
 * which is what lets the API validate paths and enforce the size limits
 * without reading anything (ADR-0032); `GET /resources/{id}/files` returns
 * it as the *actual* manifest, read back from storage.
 */
export const ArtifactFileSchema = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
});
export type ArtifactFile = z.infer<typeof ArtifactFileSchema>;

/** `GET /resources/{id}/files`: every file the Resource's Artifact holds, sorted by path. */
export const ArtifactManifestSchema = z.object({
  files: z.array(ArtifactFileSchema),
});
export type ArtifactManifest = z.infer<typeof ArtifactManifestSchema>;

/** Where the caller writes one file of an Artifact. The bytes never pass through the API (ADR-0001). */
export const ArtifactFileUploadSchema = z.object({
  path: z.string(),
  url: z.string(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
});
export type ArtifactFileUpload = z.infer<typeof ArtifactFileUploadSchema>;

/**
 * Where a publisher writes its Artifact: one presigned destination per file
 * of the manifest it declared, in that same order (ADR-0032). Every URL
 * shares the one expiry, since they are all signed by the same call.
 */
export const ArtifactUploadSchema = z.object({
  files: z.array(ArtifactFileUploadSchema),
  expires_in_seconds: z.number().int(),
});
export type ArtifactUpload = z.infer<typeof ArtifactUploadSchema>;

/**
 * PUT /resources/\{kind\}/\{name\} request body. The name comes from the path.
 * The four frontmatter extras are optional and unvalidated at this layer —
 * the shared validation rules (`validateSkillLicense` and friends) are what
 * actually enforce the specification, the same way `description` and
 * `body` are not length-checked here either. `tags` is deliberately absent:
 * publishing never sets it (docs/adr/0008) — see `PUT /resources/{id}/tags`
 * (`SetSkillTagsSchema`) instead.
 *
 * `files` is the Artifact's manifest — the paths and sizes the publisher is
 * about to upload. It is part of the *metadata* claim rather than a separate
 * call because the presigned destinations the response hands back are
 * derived from it: the API cannot sign a PUT for a key it has not been told
 * about (ADR-0032).
 */
export const SkillPublishSchema = z.object({
  description: z.string(),
  body: z.string(),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  allowed_tools: z.string().optional(),
  files: z.array(ArtifactFileSchema),
});
export type SkillPublish = z.infer<typeof SkillPublishSchema>;

/** `PUT /resources/{kind}/{name}`'s response: the Skill as stored, and where to write its Artifact. */
export const SkillPublishedSchema = z.object({
  skill: SkillSchema,
  upload: ArtifactUploadSchema,
});
export type SkillPublished = z.infer<typeof SkillPublishedSchema>;
