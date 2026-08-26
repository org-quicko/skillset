import {
  isSkillDirectorySortField,
  isSkillDirectorySortOrder,
  SKILL_DIRECTORY_DEFAULT_PAGE_SIZE,
  SKILL_DIRECTORY_MAX_PAGE_SIZE,
  SKILL_DIRECTORY_MIN_PAGE_SIZE,
  SKILL_DIRECTORY_SORT_FIELDS,
  SKILL_DIRECTORY_SORT_ORDERS,
  validateSkillAllowedTools,
  validateSkillBody,
  validateSkillCompatibility,
  validateSkillDescription,
  validateSkillLicense,
  validateSkillMetadata,
  validateSkillName,
  type SkillDirectorySortField,
  type SkillDirectorySortOrder,
} from "@skill-registry/shared";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { skillDirectory, skillTags, skills, users, type UserRow } from "../db/schema.js";
import { ArtifactMissingError, SkillDeleteFailedError, SkillNotFoundError, ValidationError } from "../http/errors.js";
import type { Logger } from "../logger.js";
import { getInstallCount, recordInstall } from "./analytics.js";
import { getSkillTags, type TagSummary } from "./tags.js";
import {
  ARTIFACT_CONTENT_TYPE,
  ARTIFACT_DOWNLOAD_EXPIRY_SECONDS,
  ARTIFACT_UPLOAD_EXPIRY_SECONDS,
  artifactKey,
} from "../storage/keys.js";
import type { StorageAdapter } from "../storage/types.js";

export interface SkillsServiceDependencies {
  db: Database;
  storage: StorageAdapter;
  logger: Logger;
}

/**
 * The wire's `published_by` is the Publisher object, not the column: the
 * email snapshot on the Skill row is always present, while the id and names
 * come from the User row and are null once that User has been removed
 * (docs/data-model.md). Selecting it in this shape is what lets a caller
 * respond with `SkillSchema.parse(row)` and no mapping step.
 */
const skillSelection = {
  id: skills.id,
  name: skills.name,
  description: skills.description,
  body: skills.body,
  license: skills.license,
  compatibility: skills.compatibility,
  metadata: skills.metadata,
  allowed_tools: skills.allowed_tools,
  published_at: skills.published_at,
  published_by: {
    user_id: users.id,
    email: skills.published_by_email,
    first_name: users.first_name,
    last_name: users.last_name,
  },
};

// The Publisher is null-per-field, not null-as-a-whole: `leftJoin` nulls out
// only the columns that come from `users`, while `email` — snapshotted onto
// the Skill row itself — is always present (see skillSelection above).
interface SkillPublisher {
  user_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

interface SkillSummary {
  id: string;
  name: string;
  description: string;
  license: string | null;
  compatibility: string | null;
  metadata: Record<string, string> | null;
  allowed_tools: string | null;
  tags: TagSummary[];
  published_at: Date;
  published_by: SkillPublisher;
  // Never null: 0 until an Install is recorded and a refresh has picked it
  // up (ADR-0012) — `skill_analytics` has no row for a Skill until then.
  installs: number;
}

interface SkillDetail extends SkillSummary {
  body: string;
}

interface PublishedSkill extends SkillDetail {
  // The publisher just authenticated the request — every field is known,
  // unlike the leftJoin-derived, possibly-removed Publisher above.
  published_by: { user_id: string; email: string; first_name: string; last_name: string };
}

interface SkillUpload {
  url: string;
  method: string;
  headers: { "content-type": string };
  expires_in_seconds: number;
}

/**
 * One row of `GET /skills` (ticket 23) — deliberately not `SkillSummary`
 * above: sourced from `skill_directory`, which trades the full Publisher
 * object for a `published_by_name` snapshot and `published_at` for
 * `updated_at` (docs/data-model.md).
 */
interface SkillDirectoryEntry {
  id: string;
  name: string;
  description: string;
  published_by_name: string;
  updated_at: Date;
  installs: number;
  tags: TagSummary[];
}

export interface ListSkillsOptions {
  /** The requested page number, as a string straight from a query parameter. */
  page?: string;
  /** The raw `q` search term, or `undefined`/blank for no search. */
  q?: string;
  /** Repeatable `tag_id` query parameters — a Skill qualifies if it carries any one of them. */
  tagIds?: string[];
  /** `"installs"` or `"updated_at"`; defaults to `"installs"`. */
  sortBy?: string;
  /** `"asc"` or `"desc"`; defaults to `"desc"`. */
  sortOrder?: string;
  /** Clamped to [1, 100]; defaults to 10. */
  pageSize?: string;
}

/** A page below 1 — or not a number at all — is the first page, not an error. */
function parsePage(raw: string | undefined): number {
  const page = Number(raw ?? "1");
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** Only a well-formed UUID can match a `tags.id` — anything else is dropped rather than sent to Postgres. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Silently drops malformed ids from a client-supplied, repeatable `tag_id` list rather than rejecting the whole request over one bad value. */
function parseTagIds(raw: string[] | undefined): string[] {
  return (raw ?? []).filter((id) => UUID_PATTERN.test(id));
}

/**
 * `sort_by` is one of `SKILL_DIRECTORY_SORT_FIELDS`, or absent for the
 * default — anything else is a validation failure, not a silent fallback
 * (ticket 23).
 *
 * @throws ValidationError if `raw` is present and not a recognised value.
 */
function parseSortBy(raw: string | undefined): SkillDirectorySortField {
  if (raw === undefined) return "installs";
  if (!isSkillDirectorySortField(raw)) {
    throw new ValidationError(`sort_by must be one of: ${SKILL_DIRECTORY_SORT_FIELDS.join(", ")}.`, "sort_by");
  }
  return raw;
}

/**
 * `sort_order` is one of `SKILL_DIRECTORY_SORT_ORDERS`, or absent for the
 * default — anything else is a validation failure, not a silent fallback
 * (ticket 23).
 *
 * @throws ValidationError if `raw` is present and not a recognised value.
 */
function parseSortOrder(raw: string | undefined): SkillDirectorySortOrder {
  if (raw === undefined) return "desc";
  if (!isSkillDirectorySortOrder(raw)) {
    throw new ValidationError(`sort_order must be one of: ${SKILL_DIRECTORY_SORT_ORDERS.join(", ")}.`, "sort_order");
  }
  return raw;
}

/** Clamped to [1, 100] rather than rejected — unlike `sort_by`/`sort_order` (ticket 23). Anything not a whole number falls back to the default. */
function parsePageSize(raw: string | undefined): number {
  const size = Number(raw);
  if (!Number.isInteger(size)) return SKILL_DIRECTORY_DEFAULT_PAGE_SIZE;
  return Math.min(SKILL_DIRECTORY_MAX_PAGE_SIZE, Math.max(SKILL_DIRECTORY_MIN_PAGE_SIZE, size));
}

/** A blank or all-whitespace search term is treated as no search term at all. */
function parseQuery(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Turns a term's last token into a `tsquery` prefix-match flag, unless
 * that token is a quoted phrase or a `-exclusion`.
 *
 * @remarks
 * Stripped down to letters, digits, underscores, and hyphens first —
 * `to_tsquery` syntax breaks on anything else a reader might have typed
 * (a stray quote, `&`, `:`). The hyphen is kept rather than stripped
 * because Postgres's own parser uses it to decompose a compound token
 * into several lexemes, and carries a `:*` flag across all of them —
 * the same rule that makes `to_tsquery('async-await')` implicitly become
 * `async & await` also makes `to_tsquery('async-await:*')` become
 * `async:* & await:*`, so this doesn't need to reimplement that
 * decomposition itself.
 *
 * @param lastToken - The term's final whitespace-delimited token, or
 * `undefined` if the term was empty.
 * @returns The token with a trailing `:*`, or `undefined` if it was a
 * phrase, an exclusion, or sanitised down to nothing.
 */
function prefixToken(lastToken: string | undefined): string | undefined {
  if (!lastToken || lastToken.startsWith("-") || lastToken.startsWith('"')) return undefined;
  const cleaned = lastToken.replace(/[^a-zA-Z0-9_-]/g, "");
  return cleaned ? `${cleaned}:*` : undefined;
}

/**
 * Builds the `search @@ …` condition for a non-blank search term.
 *
 * @remarks
 * Every finished word, `"quoted phrase"`, and `-exclusion` is parsed
 * exactly as `websearch_to_tsquery` always has — this only changes
 * behaviour for the term's last token, which doubles as the word a
 * reader is still typing. That token is prefix-matched instead
 * (`prefixToken`), so a partial word matches immediately rather than
 * only once it's fully typed — the type-ahead behaviour
 * `websearch_to_tsquery` has no mode for
 * (docs/adr/0004-postgres-over-sqlite.md). A term that ends in a phrase
 * or exclusion instead falls back to the unmodified
 * `websearch_to_tsquery` call, since prefix-matching a fragment of an
 * already-closed phrase or exclusion doesn't make sense.
 *
 * `search` here is `skill_directory`'s copy of `skills.search` (docs/data-model.md)
 * — the same generated tsvector, now also folding in `published_by_name`
 * (ticket 23), so a term matching only a Skill's publisher still matches.
 *
 * @param query - A trimmed, non-empty search term.
 * @returns A boolean SQL expression for a `where` clause.
 * @example
 * buildSearchCondition("postgre") // matches "postgresql-migrations"
 */
function buildSearchCondition(query: string) {
  const tokens = query.match(/-?"[^"]*"|-?\S+/g) ?? [];
  const prefix = prefixToken(tokens[tokens.length - 1]);
  if (!prefix) return sql`${skillDirectory.search} @@ websearch_to_tsquery('english', ${query})`;

  const headTerm = tokens.slice(0, -1).join(" ");
  // Parenthesised explicitly: `@@` and `&&` sit at the same precedence tier
  // and associate left-to-right, so an unparenthesised
  // `search @@ a && b` parses as `(search @@ a) && b` — a boolean `&&`
  // tsquery, which Postgres rejects.
  return headTerm
    ? sql`${skillDirectory.search} @@ (websearch_to_tsquery('english', ${headTerm}) && to_tsquery('english', ${prefix}))`
    : sql`${skillDirectory.search} @@ to_tsquery('english', ${prefix})`;
}

/**
 * Runs an id-keyed lookup, treating a malformed id the same as "no row" —
 * Postgres rejects a non-UUID literal with `invalid_text_representation`
 * (22P02) before it ever gets the chance to not-match, so that's caught
 * here rather than pre-validated: letting Postgres itself reject the format
 * means there's no separate format check to keep in sync with what the
 * database actually accepts.
 *
 * @param query - Runs the id-keyed select; called with the id already bound.
 * @returns The first row, or `undefined` for a malformed id or no match — the caller decides what "not found" means.
 */
async function selectByIdOrUndefined<T>(query: () => Promise<T[]>): Promise<T | undefined> {
  try {
    const [row] = await query();
    return row;
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && (cause as { code?: string }).code === "22P02") return undefined;
    throw cause;
  }
}

/**
 * Resolves a Skill's id to its current name, so a route needs only the id
 * the wire gives it — the Artifact's storage key is still derived from the
 * name (docs/data-model.md).
 *
 * @param deps - The database this reads from.
 * @param id - The Skill's id.
 * @returns The Skill's current name.
 * @throws SkillNotFoundError if `id` is not a well-formed UUID, or no Skill exists by it.
 */
async function getSkillNameById(deps: SkillsServiceDependencies, id: string): Promise<string> {
  const skill = await selectByIdOrUndefined(() =>
    deps.db.select({ name: skills.name }).from(skills).where(eq(skills.id, id)).limit(1),
  );
  if (!skill) throw new SkillNotFoundError();
  return skill.name;
}

/**
 * Lists Skills from `skill_directory` (ticket 23), one page at a time,
 * optionally narrowed by a full-text search term and one or more Tags, and
 * sorted by install count or last-updated.
 *
 * @remarks
 * A search term is matched against the generated `search` column with
 * Postgres's web-search query parser (`websearch_to_tsquery`), which accepts
 * a plain phrase, `"quoted phrases"`, and `-exclusions`
 * (docs/adr/0004-postgres-over-sqlite.md), except for the term's last token:
 * that one is prefix-matched instead (`buildSearchCondition`), so a search
 * box wired straight to this endpoint gets type-ahead results rather than
 * needing a full word before anything matches. It still stems rather than
 * substring-matches once a word is finished — `postgre` will find
 * "postgresql" as a prefix, but a later, unrelated word like `sql` still
 * will not — and hyphenated identifiers tokenise per word, so an unquoted
 * hyphenated term matches any Skill containing all of its words, not just
 * the one it names. A blank or missing term is treated as no search at all.
 *
 * `options.tagIds`, when non-empty, narrows to Skills carrying at least one
 * of those Tags — a membership check against `skill_tags` directly, not
 * against `skill_directory.tags` (docs/data-model.md). `sort_by`/`sort_order`
 * govern ordering unconditionally, even with a search term active — there is
 * no separate relevance ranking.
 *
 * @param deps - The database this reads from.
 * @param options - The raw, unvalidated query parameters this endpoint accepts.
 * @returns The matching page of Skills, alongside the page number, page
 * size, and the total count of matches (not the unfiltered table).
 * @throws ValidationError if `options.sortBy` or `options.sortOrder` is
 * present and not a recognised value.
 * @example
 * ```ts
 * // GET /skills?q=%22code%20review%22&tag_id=<id>&sort_by=updated_at&page=2
 * await listSkills(deps, { q: '"code review"', tagIds: ["<id>"], sortBy: "updated_at", page: "2" });
 * ```
 */
export async function listSkills(
  deps: SkillsServiceDependencies,
  options: ListSkillsOptions,
): Promise<{ items: SkillDirectoryEntry[]; page: number; page_size: number; total: number }> {
  const page = parsePage(options.page);
  const query = parseQuery(options.q);
  const tagIds = parseTagIds(options.tagIds);
  const sortBy = parseSortBy(options.sortBy);
  const sortOrder = parseSortOrder(options.sortOrder);
  const pageSize = parsePageSize(options.pageSize);

  const matches = query ? buildSearchCondition(query) : undefined;
  const tagFilter =
    tagIds.length > 0
      ? inArray(
          skillDirectory.id,
          deps.db.select({ id: skillTags.skill_id }).from(skillTags).where(inArray(skillTags.tag_id, tagIds)),
        )
      : undefined;
  const where = and(matches, tagFilter);

  const sortColumn = sortBy === "installs" ? skillDirectory.install_count : skillDirectory.updated_at;
  const orderBy = sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

  const rows = await deps.db
    .select({
      id: skillDirectory.id,
      name: skillDirectory.name,
      description: skillDirectory.description,
      published_by_name: skillDirectory.published_by_name,
      updated_at: skillDirectory.updated_at,
      installs: skillDirectory.install_count,
      tags: skillDirectory.tags,
    })
    .from(skillDirectory)
    .where(where)
    // A tiebreak on id (uuidv7, so still insertion-ordered) is not
    // cosmetic: without one, rows sharing a sort_by value (e.g. every
    // never-installed Skill, all reading 0) have no guaranteed order across
    // requests, which infinite scroll depends on to never repeat or skip a
    // row between pages.
    .orderBy(orderBy, asc(skillDirectory.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [totals] = await deps.db.select({ total: count() }).from(skillDirectory).where(where);

  return { items: rows, page, page_size: pageSize, total: totals?.total ?? 0 };
}

/**
 * Reads a single Skill by its id.
 *
 * @remarks
 * An exact-id read against the primary key. Full-text search is a
 * different route's job — a lookup by id never goes through it.
 *
 * @param deps - The database this reads from.
 * @param id - The Skill's id.
 * @returns `SkillDetail`
 * @throws SkillNotFoundError if `id` is not a well-formed UUID, or no Skill exists by it.
 * @example
 * ```ts
 * const skill = await getSkill(deps, id);
 * ```
 */
export async function getSkill(deps: SkillsServiceDependencies, id: string): Promise<SkillDetail> {
  const skill = await selectByIdOrUndefined(() =>
    deps.db
      .select(skillSelection)
      .from(skills)
      .leftJoin(users, eq(skills.published_by, users.id))
      .where(eq(skills.id, id))
      .limit(1),
  );
  if (!skill) throw new SkillNotFoundError();
  const [tags, installs] = await Promise.all([getSkillTags(deps, skill.id), getInstallCount(deps, skill.id)]);
  return { ...skill, tags, installs };
}

/**
 * Reads a single Skill by its exact name.
 *
 * @remarks
 * The web keeps `/skills/<name>` as its own browser URL and needs an
 * authoritative name → id resolution for a reader who lands there with
 * nothing already cached (a bookmark, a shared link, a refresh) — this is
 * that lookup. A single indexed equality match against the unique `name`
 * column, not full-text search: `GET /skills?q=` ranks by recency and caps
 * at one page, so it cannot guarantee finding an existing Skill by exact
 * name, and Postgres's `english` search config drops stopwords entirely,
 * which would silently 404 a real Skill whose name happens to be one
 * (docs/data-model.md's `name` format allows single-word, even
 * single-character, names).
 *
 * @param deps - The database this reads from.
 * @param name - The Skill's name.
 * @returns `SkillDetail`
 * @throws SkillNotFoundError if no Skill exists by that name.
 * @example
 * ```ts
 * const skill = await getSkillByName(deps, "code-review");
 * ```
 */
export async function getSkillByName(deps: SkillsServiceDependencies, name: string): Promise<SkillDetail> {
  const [skill] = await deps.db
    .select(skillSelection)
    .from(skills)
    .leftJoin(users, eq(skills.published_by, users.id))
    .where(eq(skills.name, name))
    .limit(1);

  if (!skill) throw new SkillNotFoundError();
  const [tags, installs] = await Promise.all([getSkillTags(deps, skill.id), getInstallCount(deps, skill.id)]);
  return { ...skill, tags, installs };
}

/**
 * Validates and publishes a Skill, then returns a presigned URL to upload
 * its Artifact to.
 *
 * @remarks
 * Idempotent by name: publishing an existing Skill replaces its
 * description and body, and the publisher and published-at become
 * whoever published it last (ADR-0002). The row is written before the
 * Artifact is uploaded, so between the two the Skill lists and reads but
 * its Artifact cannot yet be retrieved.
 *
 * @param deps - The database, storage adapter, and logger this needs.
 * @param publisher - The authenticated User publishing the Skill.
 * @param rawName - The Skill's name, taken from the request path and not
 * yet validated.
 * @param payload - The request body, expected to carry `description` and
 * `body`, and optionally `license`, `compatibility`, `metadata`, and
 * `allowed_tools`; not yet known to have any of them.
 * @returns `{ skill: PublishedSkill; upload: SkillUpload }`
 * @throws SkillValidationError if `rawName`, `payload.description`,
 * `payload.body`, or any present optional field fails validation. A
 * failing optional field rejects the publish exactly like a failing
 * required one (ADR-0009) — nothing about the Skill changes.
 * @example
 * ```ts
 * const { skill, upload } = await publishSkill(deps, publisher, "my-skill", {
 *   description: "Does a thing.",
 *   body: "# my-skill\n...",
 * });
 * ```
 */
export async function publishSkill(
  deps: SkillsServiceDependencies,
  publisher: UserRow,
  rawName: string,
  payload: Record<string, unknown> | null,
): Promise<{ skill: PublishedSkill; upload: SkillUpload }> {
  // The name comes from the path; the caller parsed it out of the SKILL.md
  // frontmatter. Validated here against the same rules the shared module
  // applies — the API does not read the Artifact to confirm the two agree
  // (ADR-0001). A `SkillValidationError` here bubbles to the central error
  // handler unchanged.
  const name = validateSkillName(rawName);
  const description = validateSkillDescription(payload?.description);
  const body = validateSkillBody(payload?.body);
  // Optional, validated as strictly as when set, whether required or
  // optional — any one of them failing rejects the whole publish
  // (ADR-0009). Coerced to `null` rather than left `undefined`: a republish
  // fully replaces the frontmatter (ADR-0002), so a field the payload no
  // longer sets must clear whatever an earlier publish stored, not leave it
  // lingering.
  const license = validateSkillLicense(payload?.license) ?? null;
  const compatibility = validateSkillCompatibility(payload?.compatibility) ?? null;
  const metadata = validateSkillMetadata(payload?.metadata) ?? null;
  const allowed_tools = validateSkillAllowedTools(payload?.allowed_tools) ?? null;

  // Idempotent by name: publishing an existing Skill replaces it whoever
  // published it first, and the publisher and published-at become whoever
  // published it last (ADR-0002). `tags` never appears in this insert or
  // conflict update at all — it isn't a column on `skills` any more, and no
  // publish path ever writes it regardless (ADR-0008, ADR-0011), so a
  // republish leaves a Skill's Tags exactly as they were.
  const published_at = new Date();
  // Snapshotted alongside published_by_email, for the same reason (ticket
  // 23): a display name the Skill list and full-text search can use without
  // a live join to `users`, that survives this User being renamed or removed.
  const published_by_name = `${publisher.first_name} ${publisher.last_name}`;
  const [row] = await deps.db
    .insert(skills)
    .values({
      name,
      description,
      body,
      license,
      compatibility,
      metadata,
      allowed_tools,
      published_by: publisher.id,
      published_by_email: publisher.email,
      published_by_name,
      published_at,
    })
    .onConflictDoUpdate({
      target: skills.name,
      set: {
        description,
        body,
        license,
        compatibility,
        metadata,
        allowed_tools,
        published_by: publisher.id,
        published_by_email: publisher.email,
        published_by_name,
        published_at,
        updated_at: new Date(),
      },
    })
    .returning();
  if (!row) throw new Error("Upsert did not return the published Skill.");

  // The row is written first and an upload target returned. Until the
  // caller writes the Artifact there, the Skill lists and reads but its
  // Artifact cannot be retrieved.
  const url = await deps.storage.presignUpload(artifactKey(name), {
    expiresInSeconds: ARTIFACT_UPLOAD_EXPIRY_SECONDS,
    contentType: ARTIFACT_CONTENT_TYPE,
  });

  deps.logger.info({ skill_name: name, user_id: publisher.id }, "skill published");

  return {
    skill: {
      id: row.id,
      name: row.name,
      description: row.description,
      body: row.body,
      license: row.license,
      compatibility: row.compatibility,
      metadata: row.metadata,
      allowed_tools: row.allowed_tools,
      // A republish's Tags and install count both survive untouched —
      // publishing never writes skill_tags or skill_install_events, and
      // nothing but refreshInstallCounts ever writes skill_analytics
      // (ADR-0012); a brand new Skill simply has neither yet.
      tags: await getSkillTags(deps, row.id),
      installs: await getInstallCount(deps, row.id),
      published_at: row.published_at,
      published_by: {
        user_id: publisher.id,
        email: publisher.email,
        first_name: publisher.first_name,
        last_name: publisher.last_name,
      },
    },
    upload: {
      url,
      method: "PUT",
      headers: { "content-type": ARTIFACT_CONTENT_TYPE },
      expires_in_seconds: ARTIFACT_UPLOAD_EXPIRY_SECONDS,
    },
  };
}

/**
 * Permanently deletes a Skill and its Artifact.
 *
 * @remarks
 * Irreversible (spec: the one action withheld from writers) — no version
 * history, no soft delete (ADR-0002). Existence is checked up front so a
 * missing Skill 404s before either delete runs; the storage delete happens
 * first because a dangling row with no Artifact is a state the API already
 * tolerates (a Skill whose Artifact was never uploaded), while a dangling
 * Artifact for a row that no longer exists is not.
 *
 * @param deps - The database, storage adapter, and logger this needs.
 * @param id - The Skill's id.
 * @throws SkillNotFoundError if `id` is not a well-formed UUID, or no Skill exists by it.
 * @throws SkillDeleteFailedError if the storage or database delete fails.
 */
export async function deleteSkill(deps: SkillsServiceDependencies, id: string): Promise<void> {
  const name = await getSkillNameById(deps, id);

  try {
    await deps.storage.delete(artifactKey(name));
    await deps.db.delete(skills).where(eq(skills.id, id));
  } catch (cause) {
    throw new SkillDeleteFailedError(cause);
  }

  deps.logger.info({ skill_name: name }, "skill deleted");
}

/**
 * Presigns a short-lived URL to download a Skill's Artifact.
 *
 * @remarks
 * Any authenticated User may retrieve an Artifact — reader is the base
 * role, so the route's requireAuth alone is the whole authorisation check.
 * Counts as one Install (ADR-0012, spec: `.scratch/skill-analytics/spec.md`)
 * — the only point the API can observe a download, since the Artifact
 * itself transfers directly from storage and the API never sees it finish.
 * Only recorded once the Artifact is confirmed to exist, so a 404 for a
 * missing Artifact never inflates the count.
 *
 * @param deps - The database and storage adapter this needs.
 * @param id - The Skill's id.
 * @returns `string`
 * @throws SkillNotFoundError if `id` is not a well-formed UUID, or no Skill exists by it.
 * @throws ArtifactMissingError if the Skill's Artifact was never uploaded.
 * @example
 * ```ts
 * const url = await getArtifactDownloadUrl(deps, id);
 * ```
 */
export async function getArtifactDownloadUrl(deps: SkillsServiceDependencies, id: string): Promise<string> {
  const name = await getSkillNameById(deps, id);

  const key = artifactKey(name);
  if (!(await deps.storage.exists(key))) throw new ArtifactMissingError();

  await recordInstall(deps, id, "web");

  return deps.storage.presignDownload(key, { expiresInSeconds: ARTIFACT_DOWNLOAD_EXPIRY_SECONDS });
}
