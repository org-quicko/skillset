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
  type Page,
  type SkillDirectorySortField,
  type SkillDirectorySortOrder,
} from "@skill-registry/shared";
import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { isInvalidIdSyntax } from "../db/pg-errors.js";
import { skillDirectory, skillTags, skills, users, type UserRow } from "../db/schemas/index.js";
import { ArtifactMissingError, SkillDeleteFailedError, SkillNotFoundError, ValidationError } from "../http/errors.js";
import type { Logger } from "../logger.js";
import type { AnalyticsService } from "./analytics.js";
import type { TagsService, TagSummary } from "./tags.js";
import {
  ARTIFACT_CONTENT_TYPE,
  ARTIFACT_DOWNLOAD_EXPIRY_SECONDS,
  ARTIFACT_UPLOAD_EXPIRY_SECONDS,
  artifactKey,
} from "../storage/keys.js";
import type { StorageAdapter } from "../storage/types.js";

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
 * Stripped to letters, digits, underscores, and hyphens first — `to_tsquery`
 * syntax breaks on a stray quote, `&`, or `:`. The hyphen is kept because
 * Postgres decomposes a compound token itself and carries `:*` across every
 * lexeme: `to_tsquery('async-await:*')` becomes `async:* & await:*`.
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
 * Finished words, `"quoted phrases"`, and `-exclusions` are parsed exactly as
 * `websearch_to_tsquery` parses them. Only the last token differs: it doubles
 * as the word a reader is still typing, so it is prefix-matched
 * (`prefixToken`) to give type-ahead, which `websearch_to_tsquery` has no mode
 * for (docs/adr/0004-postgres-over-sqlite.md). A term ending in a phrase or
 * exclusion falls back to the unmodified call.
 *
 * `search` is `skill_directory`'s copy of `skills.search`, which also folds in
 * `published_by_name` (docs/data-model.md), so a term matching only a Skill's
 * publisher still matches.
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
 * Runs an id-keyed lookup, treating a malformed id the same as "no row".
 *
 * @param query - Runs the id-keyed select; called with the id already bound.
 * @returns The first row, or `undefined` for a malformed id or no match — the
 * caller decides what "not found" means.
 */
async function selectByIdOrUndefined<T>(query: () => Promise<T[]>): Promise<T | undefined> {
  try {
    const [row] = await query();
    return row;
  } catch (cause) {
    if (isInvalidIdSyntax(cause)) return undefined;
    throw cause;
  }
}

/** Skills: the directory listing, reads, publishing, deletion, and Artifact access. */
export class SkillsService {
  constructor(
    private readonly db: Database,
    private readonly storage: StorageAdapter,
    private readonly logger: Logger,
    private readonly tags: TagsService,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * Lists Skills from `skill_directory` (ticket 23), one page at a time,
   * optionally narrowed by a full-text search term and one or more Tags, and
   * sorted by install count or last-updated.
   *
   * @remarks
   * `buildSearchCondition` documents how a term is matched. It stems rather
   * than substring-matches, so `postgre` finds "postgresql" as a prefix but
   * `sql` does not, and an unquoted hyphenated term matches any Skill carrying
   * all of its words. A blank or missing term is no search at all.
   *
   * `options.tagIds`, when non-empty, narrows to Skills carrying at least one
   * of those Tags — checked against `skill_tags` directly, not against
   * `skill_directory.tags` (docs/data-model.md). Ordering is governed by
   * `sort_by`/`sort_order` even with a search term active; there is no
   * relevance ranking.
   *
   * @param options - The raw, unvalidated query parameters this endpoint accepts.
   * @returns The matching page of Skills, alongside the page number, page
   * size, and the total count of matches (not the unfiltered table).
   * @throws ValidationError if `options.sortBy` or `options.sortOrder` is
   * present and not a recognised value.
   * @example
   * ```ts
   * // GET /skills?q=%22code%20review%22&tag_id=<id>&sort_by=updated_at&page=2
   * await skillsService.list({ q: '"code review"', tagIds: ["<id>"], sortBy: "updated_at", page: "2" });
   * ```
   */
  async list(options: ListSkillsOptions): Promise<Page<SkillDirectoryEntry>> {
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
            this.db.select({ id: skillTags.skill_id }).from(skillTags).where(inArray(skillTags.tag_id, tagIds)),
          )
        : undefined;
    const where = and(matches, tagFilter);

    const sortColumn = sortBy === "installs" ? skillDirectory.install_count : skillDirectory.updated_at;
    const orderBy = sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

    const rows = await this.db
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
      // Tiebreak on id (uuidv7, so insertion-ordered). Without one, rows
      // sharing a sort_by value — every never-installed Skill reads 0 — have no
      // stable order across requests, and infinite scroll repeats or skips rows.
      .orderBy(orderBy, asc(skillDirectory.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [totals] = await this.db.select({ total: count() }).from(skillDirectory).where(where);

    return { items: rows, page, page_size: pageSize, total: totals?.total ?? 0 };
  }

  /**
   * Reads a single Skill by its id.
   *
   * @remarks
   * An exact-id read against the primary key. Full-text search is a
   * different route's job — a lookup by id never goes through it.
   *
   * @param id - The Skill's id.
   * @returns `SkillDetail`
   * @throws SkillNotFoundError if `id` is not a well-formed UUID, or no Skill exists by it.
   * @example
   * ```ts
   * const skill = await skillsService.get(id);
   * ```
   */
  async get(id: string): Promise<SkillDetail> {
    return this.readSkill(eq(skills.id, id));
  }

  /**
   * Reads a single Skill by its exact name.
   *
   * @remarks
   * The web keeps `/skills/<name>` as a browser URL, so a reader arriving from
   * a bookmark or shared link needs an authoritative name → id resolution.
   *
   * An indexed equality match on the unique `name` column, not search:
   * `GET /skills?q=` ranks by recency and caps at one page, and Postgres's
   * `english` config drops stopwords — which would 404 a real Skill whose name
   * happens to be one (docs/data-model.md allows single-word names).
   *
   * @param name - The Skill's name.
   * @returns `SkillDetail`
   * @throws SkillNotFoundError if no Skill exists by that name.
   * @example
   * ```ts
   * const skill = await skillsService.getByName("code-review");
   * ```
   */
  async getByName(name: string): Promise<SkillDetail> {
    return this.readSkill(eq(skills.name, name));
  }

  /**
   * Reads the one Skill matching `where`, whole.
   *
   * @remarks
   * The single place a Skill is assembled. Every read path goes through it —
   * by id, by name, and the response to a publish — so a column added to
   * `skillSelection` reaches all three at once. It used to be assembled three
   * times, twice as this select and once as a hand-written literal, and
   * nothing failed if a new column reached only some of them.
   *
   * Tags and install count are not columns on `skills`: Tags are a join
   * through `skill_tags` (ADR-0011) and the count comes off the
   * `skill_analytics` view (ADR-0012), so both are fetched alongside — and
   * concurrently, since neither depends on the other.
   *
   * A malformed id is treated as "no row" rather than an error. Postgres
   * raises 22P02 only for the uuid comparison, so a name-keyed call cannot
   * trigger that branch — it costs nothing to apply it uniformly and it saves
   * having two spellings of this method.
   *
   * @param where - The condition identifying the Skill, over `skills`.
   * @returns `SkillDetail`
   * @throws SkillNotFoundError if nothing matches, or `where` compares a
   * malformed id.
   * @example
   * ```ts
   * const skill = await this.readSkill(eq(skills.name, "code-review"));
   * ```
   */
  private async readSkill(where: SQL): Promise<SkillDetail> {
    const skill = await selectByIdOrUndefined(() =>
      this.db
        .select(skillSelection)
        .from(skills)
        .leftJoin(users, eq(skills.published_by, users.id))
        .where(where)
        .limit(1),
    );
    if (!skill) throw new SkillNotFoundError();

    const [tags, installs] = await Promise.all([
      this.tags.getSkillTags(skill.id),
      this.analytics.getInstallCount(skill.id),
    ]);
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
   * @param publisher - The authenticated User publishing the Skill.
   * @param rawName - The Skill's name, taken from the request path and not
   * yet validated.
   * @param payload - The request body, expected to carry `description` and
   * `body`, and optionally `license`, `compatibility`, `metadata`, and
   * `allowed_tools`; not yet known to have any of them.
   * @returns `{ skill: SkillDetail; upload: SkillUpload }`
   * @throws SkillValidationError if `rawName`, `payload.description`,
   * `payload.body`, or any present optional field fails validation. A
   * failing optional field rejects the publish exactly like a failing
   * required one (ADR-0009) — nothing about the Skill changes.
   * @example
   * ```ts
   * const { skill, upload } = await skillsService.publish(publisher, "my-skill", {
   *   description: "Does a thing.",
   *   body: "# my-skill\n...",
   * });
   * ```
   */
  async publish(
    publisher: UserRow,
    rawName: string,
    payload: Record<string, unknown> | null,
  ): Promise<{ skill: SkillDetail; upload: SkillUpload }> {
    // The caller parsed the name out of the SKILL.md frontmatter. The API does
    // not read the Artifact to confirm the two agree (ADR-0001).
    const name = validateSkillName(rawName);
    const description = validateSkillDescription(payload?.description);
    const body = validateSkillBody(payload?.body);
    // Coerced to `null`, not left `undefined`: a republish fully replaces the
    // frontmatter (ADR-0002), so a field the payload no longer sets must clear
    // what an earlier publish stored.
    const license = validateSkillLicense(payload?.license) ?? null;
    const compatibility = validateSkillCompatibility(payload?.compatibility) ?? null;
    const metadata = validateSkillMetadata(payload?.metadata) ?? null;
    const allowed_tools = validateSkillAllowedTools(payload?.allowed_tools) ?? null;

    // `tags` appears in neither the insert nor the conflict update: it is not a
    // column on `skills`, and no publish path writes it (ADR-0008, ADR-0011),
    // so a republish leaves a Skill's Tags as they were.
    const published_at = new Date();
    // Snapshotted like published_by_email: a display name the Skill list and
    // search can use without joining `users`, surviving a rename or removal.
    const published_by_name = `${publisher.first_name} ${publisher.last_name}`;
    const [row] = await this.db
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

    const url = await this.storage.presignUpload(artifactKey(name), {
      expiresInSeconds: ARTIFACT_UPLOAD_EXPIRY_SECONDS,
      contentType: ARTIFACT_CONTENT_TYPE,
    });

    this.logger.info({ skill_name: name, user_id: publisher.id }, "skill published");

    return {
      // Read back rather than assembled from `row` and `publisher`: one place
      // shapes a Skill, so a column added to `skillSelection` appears here
      // without this method being touched. A republish's Tags and install
      // count both survive untouched — publishing never writes `skill_tags` or
      // `skill_install_events`, and nothing but `refreshInstallCounts` ever
      // writes `skill_analytics` (ADR-0012); a brand new Skill simply has
      // neither yet.
      skill: await this.readSkill(eq(skills.id, row.id)),
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
   * Irreversible: no version history, no soft delete (ADR-0002). Existence is
   * checked up front so a missing Skill 404s before either delete runs. The
   * storage delete goes first because the API already tolerates a row with no
   * Artifact, but not an Artifact with no row.
   *
   * @param id - The Skill's id.
   * @throws SkillNotFoundError if `id` is not a well-formed UUID, or no Skill exists by it.
   * @throws SkillDeleteFailedError if the storage or database delete fails.
   */
  async remove(id: string): Promise<void> {
    const name = await this.getNameById(id);

    try {
      await this.storage.delete(artifactKey(name));
      await this.db.delete(skills).where(eq(skills.id, id));
    } catch (cause) {
      throw new SkillDeleteFailedError(cause);
    }

    this.logger.info({ skill_name: name }, "skill deleted");
  }

  /**
   * Presigns a short-lived URL to download a Skill's Artifact.
   *
   * @remarks
   * Unauthenticated, like every other read (ADR-0013). Counts as one Install
   * (ADR-0012) — the only point the API can observe a download, since the
   * Artifact transfers directly from storage. Recorded only once the Artifact
   * is confirmed to exist, so a 404 never inflates the count.
   *
   * @param id - The Skill's id.
   * @returns `string`
   * @throws SkillNotFoundError if `id` is not a well-formed UUID, or no Skill exists by it.
   * @throws ArtifactMissingError if the Skill's Artifact was never uploaded.
   * @example
   * ```ts
   * const url = await skillsService.getArtifactDownloadUrl(id);
   * ```
   */
  async getArtifactDownloadUrl(id: string): Promise<string> {
    const name = await this.getNameById(id);

    const key = artifactKey(name);
    if (!(await this.storage.exists(key))) throw new ArtifactMissingError();

    await this.analytics.recordInstall(id, "web");

    return this.storage.presignDownload(key, { expiresInSeconds: ARTIFACT_DOWNLOAD_EXPIRY_SECONDS });
  }

  /**
   * Resolves a Skill's id to its current name, so a route needs only the id
   * the wire gives it — the Artifact's storage key is still derived from the
   * name (docs/data-model.md).
   *
   * @param id - The Skill's id.
   * @returns The Skill's current name.
   * @throws SkillNotFoundError if `id` is not a well-formed UUID, or no Skill exists by it.
   */
  private async getNameById(id: string): Promise<string> {
    const skill = await selectByIdOrUndefined(() =>
      this.db.select({ name: skills.name }).from(skills).where(eq(skills.id, id)).limit(1),
    );
    if (!skill) throw new SkillNotFoundError();
    return skill.name;
  }
}
