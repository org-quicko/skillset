import {
  isKind,
  KIND_KEYS,
  validateSkillAllowedTools,
  validateSkillBody,
  validateSkillCompatibility,
  validateSkillDescription,
  validateSkillLicense,
  validateSkillMetadata,
  validateSkillName,
  type Page,
  type SkillPayload,
} from "@skill-registry/shared";
import { and, asc, count, countDistinct, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { isInvalidIdSyntax } from "../db/pg-errors.js";
import { firstRow } from "../db/rows.js";
import { resourceDirectory, resourceTags, resources, users, type UserRow } from "../db/schemas/index.js";
import { ArtifactMissingError, ResourceDeleteFailedError, ResourceNotFoundError, ValidationError } from "../http/errors.js";
import type { ResourceDirectoryQuery } from "../http/resource-directory-query.js";
import type { Logger } from "../logger.js";
import type { AnalyticsService, InstallTrendPoint } from "./analytics.js";
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
 * email snapshot on the Resource row is always present, while the id and
 * names come from the User row and are null once that User has been removed
 * (docs/data-model.md). Selecting it in this shape is what lets a caller
 * respond with `SkillSchema.parse(row)` and no mapping step.
 *
 * `payload` carries the Kind's own fields (ADR-0026); `readSkill` below
 * unpacks a Skill's into the flat shape the wire has always had — the only
 * shape assembled today, since `skill` is the only registered Kind (ticket 3
 * generalises this once a second one exists).
 */
const skillSelection = {
  id: resources.id,
  kind: resources.kind,
  name: resources.name,
  description: resources.description,
  body: resources.body,
  payload: resources.payload,
  published_at: resources.published_at,
  published_by: {
    user_id: users.id,
    email: resources.published_by_email,
    first_name: users.first_name,
    last_name: users.last_name,
  },
};

// The Publisher is null-per-field, not null-as-a-whole: `leftJoin` nulls out
// only the columns that come from `users`, while `email` — snapshotted onto
// the Resource row itself — is always present (see skillSelection above).
interface SkillPublisher {
  user_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

interface SkillSummary {
  id: string;
  kind: "skill";
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
  // up (ADR-0012) — `resource_analytics` has no row for a Resource until then.
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

/** `GET /resources/stats`'s shape — see `ResourcesService.getStats`. */
interface ResourceDirectoryStats {
  skills: number;
  publishers: number;
  installs: number;
}

/**
 * One row of `GET /resources` (ticket 23, ADR-0026) — deliberately not
 * `SkillSummary` above: sourced from `resource_directory`, which trades the
 * full Publisher object for a `published_by_name` snapshot and
 * `published_at` for `updated_at` (docs/data-model.md).
 */
interface ResourceDirectoryEntry {
  id: string;
  kind: string;
  name: string;
  description: string;
  published_by_name: string;
  updated_at: Date;
  installs: number;
  tags: TagSummary[];
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
 * `search` is `resource_directory`'s copy of `resources.search`, which also
 * folds in `published_by_name` (docs/data-model.md), so a term matching only
 * a Resource's publisher still matches.
 *
 * @param query - A trimmed, non-empty search term.
 * @returns A boolean SQL expression for a `where` clause.
 * @example
 * buildSearchCondition("postgre") // matches "postgresql-migrations"
 */
function buildSearchCondition(query: string) {
  const tokens = query.match(/-?"[^"]*"|-?\S+/g) ?? [];
  const prefix = prefixToken(tokens[tokens.length - 1]);
  if (!prefix) return sql`${resourceDirectory.search} @@ websearch_to_tsquery('english', ${query})`;

  const headTerm = tokens.slice(0, -1).join(" ");
  // Parenthesised explicitly: `@@` and `&&` sit at the same precedence tier
  // and associate left-to-right, so an unparenthesised
  // `search @@ a && b` parses as `(search @@ a) && b` — a boolean `&&`
  // tsquery, which Postgres rejects.
  return headTerm
    ? sql`${resourceDirectory.search} @@ (websearch_to_tsquery('english', ${headTerm}) && to_tsquery('english', ${prefix}))`
    : sql`${resourceDirectory.search} @@ to_tsquery('english', ${prefix})`;
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

/** The install trend chart's fixed window — see `ResourcesService.getInstallTrend`. */
const INSTALL_TREND_DAYS = 30;

/**
 * Resources: the catalog listing, reads, publishing, deletion, and Artifact
 * access (ADR-0026).
 *
 * @remarks
 * `list`, `getStats`, and `get` are genuinely Kind-agnostic — they narrow to
 * one Kind only when a caller's `?kind=` or `{kind}` path segment asks them
 * to. Publishing, Artifact assembly, and the shape a Resource is read back
 * as are still Skill-only: `skill` is the only registered Kind, and
 * generalising those is ticket 3's job once a second one exists.
 */
export class ResourcesService {
  constructor(
    private readonly db: Database,
    private readonly storage: StorageAdapter,
    private readonly logger: Logger,
    private readonly tags: TagsService,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * Lists Resources from `resource_directory` (ticket 23), one page at a
   * time, optionally narrowed by Kind, a full-text search term, and one or
   * more Tags, and sorted by install count or last-updated.
   *
   * @remarks
   * `buildSearchCondition` documents how a term is matched. It stems rather
   * than substring-matches, so `postgre` finds "postgresql" as a prefix but
   * `sql` does not, and an unquoted hyphenated term matches any Resource
   * carrying all of its words. A blank or missing term is no search at all.
   *
   * `query.kind`, when set, narrows to that one Kind; omitted, every Kind is
   * listed together (ADR-0026) — with `skill` the only one registered, the
   * filter is exercisable but not yet load-bearing.
   *
   * `query.tagIds`, when non-empty, narrows to Resources carrying at least
   * one of those Tags — checked against `resource_tags` directly, not
   * against `resource_directory.tags` (docs/data-model.md). Ordering is
   * governed by `sortBy`/`sortOrder` even with a search term active; there
   * is no relevance ranking.
   *
   * Every member arrives already coerced, defaulted, and within range —
   * `parseResourceDirectoryQuery` is what produces one, and there is no way
   * to call this with a value it has not been through.
   *
   * @param query - The validated query: page, page size, search term, Kind,
   * Tag ids, and sort choice.
   * @returns The matching page of Resources, alongside the page number, page
   * size, and the total count of matches (not the unfiltered table).
   * @example
   * ```ts
   * // GET /resources?q=%22code%20review%22&kind=skill&tag_id=<id>&sort_by=updated_at&page=2
   * await resourcesService.list(parseResourceDirectoryQuery(c));
   * ```
   */
  async list(query: ResourceDirectoryQuery): Promise<Page<ResourceDirectoryEntry>> {
    const { page, pageSize, tagIds, sortBy, sortOrder, kind } = query;

    const matches = query.q ? buildSearchCondition(query.q) : undefined;
    const kindFilter = kind ? eq(resourceDirectory.kind, kind) : undefined;
    const tagFilter =
      tagIds.length > 0
        ? inArray(
            resourceDirectory.id,
            this.db.select({ id: resourceTags.resource_id }).from(resourceTags).where(inArray(resourceTags.tag_id, tagIds)),
          )
        : undefined;
    const where = and(kindFilter, matches, tagFilter);

    const sortColumn = sortBy === "installs" ? resourceDirectory.install_count : resourceDirectory.updated_at;
    const orderBy = sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

    const rows = await this.db
      .select({
        id: resourceDirectory.id,
        kind: resourceDirectory.kind,
        name: resourceDirectory.name,
        description: resourceDirectory.description,
        published_by_name: resourceDirectory.published_by_name,
        updated_at: resourceDirectory.updated_at,
        installs: resourceDirectory.install_count,
        tags: resourceDirectory.tags,
      })
      .from(resourceDirectory)
      .where(where)
      // Tiebreak on id (uuidv7, so insertion-ordered). Without one, rows
      // sharing a sort_by value — every never-installed Resource reads 0 —
      // have no stable order across requests, and infinite scroll repeats or
      // skips rows.
      .orderBy(orderBy, asc(resourceDirectory.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [totals] = await this.db.select({ total: count() }).from(resourceDirectory).where(where);

    return { items: rows, page, page_size: pageSize, total: totals?.total ?? 0 };
  }

  /**
   * Registry-wide counts for the catalog's hero stats: how many Resources
   * exist, how many distinct Publishers have published one, and how many
   * Installs have been recorded in total.
   *
   * @remarks
   * Unauthenticated, like every other read (ADR-0013), and unfiltered —
   * unlike `list`'s `total`, nothing here is narrowed by Kind, a search term,
   * or a Tag selection. `publishers` counts distinct `published_by_email`
   * values on `resources` — the snapshot that survives a Publisher's User
   * row being removed (docs/data-model.md) — rather than `published_by`,
   * which goes null in that case and would undercount.
   *
   * @returns The total Resource count, the distinct Publisher count, and the
   * total Install count across every Resource.
   * @example
   * ```ts
   * const stats = await resourcesService.getStats();
   * ```
   */
  async getStats(): Promise<ResourceDirectoryStats> {
    const [rows, installs] = await Promise.all([
      this.db.select({ skills: count(), publishers: countDistinct(resources.published_by_email) }).from(resources),
      this.analytics.getTotalInstallCount(),
    ]);

    return { skills: rows[0]?.skills ?? 0, publishers: rows[0]?.publishers ?? 0, installs };
  }

  /**
   * Reads a single Resource by its id.
   *
   * @remarks
   * An exact-id read against the primary key, whatever Kind it is. Full-text
   * search is a different route's job — a lookup by id never goes through
   * it.
   *
   * @param id - The Resource's id.
   * @returns `SkillDetail`
   * @throws ResourceNotFoundError if `id` is not a well-formed UUID, or no
   * Resource exists by it.
   * @example
   * ```ts
   * const skill = await resourcesService.get(id);
   * ```
   */
  async get(id: string): Promise<SkillDetail> {
    return this.readSkill(eq(resources.id, id));
  }

  /**
   * Reads a single Skill by its exact `(kind, name)`.
   *
   * @remarks
   * The web keeps `/skills/<name>` as a browser URL, so a reader arriving from
   * a bookmark or shared link needs an authoritative name → id resolution.
   *
   * An indexed equality match on the unique `(kind, name)` pair, not search:
   * `GET /resources?q=` ranks by recency and caps at one page, and Postgres's
   * `english` config drops stopwords — which would 404 a real Skill whose name
   * happens to be one (docs/data-model.md allows single-word names).
   *
   * @param kind - The Kind path segment, not yet known to be registered.
   * @param name - The Skill's name.
   * @returns `SkillDetail`
   * @throws ResourceNotFoundError if `kind` isn't `"skill"`, or no Skill
   * exists by that name — a route param, so an unrecognised Kind here reads
   * as "not found" rather than a validation error (unlike the same check on
   * `publish`, whose `kind` chooses what gets written).
   * @example
   * ```ts
   * const skill = await resourcesService.getByName("skill", "code-review");
   * ```
   */
  async getByName(kind: string, name: string): Promise<SkillDetail> {
    return this.readSkill(and(eq(resources.kind, kind), eq(resources.name, name)) as SQL);
  }

  /**
   * Reads the one Skill matching `identity`, whole.
   *
   * @remarks
   * The single place a Skill is assembled. Every read path goes through it —
   * by id, by `(kind, name)`, and the response to a publish — so a column
   * added to `skillSelection` reaches all three at once. It used to be
   * assembled three times, twice as this select and once as a hand-written
   * literal, and nothing failed if a new column reached only some of them.
   *
   * Tags and install count are not columns on `resources`: Tags are a join
   * through `resource_tags` (ADR-0011) and the count comes off the
   * `resource_analytics` view (ADR-0012), so both are fetched alongside — and
   * concurrently, since neither depends on the other. `license`,
   * `compatibility`, `metadata`, and `allowed_tools` come out of `payload`
   * (ADR-0026), unpacked back into the flat shape the wire has always had —
   * a Skill-only assembly, since that's the only Kind a row here can be.
   *
   * A malformed id is treated as "no row" rather than an error. Postgres
   * raises 22P02 only for the uuid comparison, so a name-keyed call cannot
   * trigger that branch — it costs nothing to apply it uniformly and it saves
   * having two spellings of this method.
   *
   * @param identity - The condition identifying the Resource, over
   * `resources` — by id alone, or by `(kind, name)`.
   * @returns `SkillDetail`
   * @throws ResourceNotFoundError if nothing matches, or `identity` compares
   * a malformed id.
   * @example
   * ```ts
   * const skill = await this.readSkill(eq(resources.id, id));
   * ```
   */
  private async readSkill(identity: SQL): Promise<SkillDetail> {
    const skill = await selectByIdOrUndefined(() =>
      this.db.select(skillSelection).from(resources).leftJoin(users, eq(resources.published_by, users.id)).where(identity).limit(1),
    );
    if (!skill) throw new ResourceNotFoundError();

    const [tags, installs] = await Promise.all([
      this.tags.getSkillTags(skill.id),
      this.analytics.getInstallCount(skill.id),
    ]);
    const payload = skill.payload as SkillPayload;
    return {
      id: skill.id,
      kind: "skill",
      name: skill.name,
      description: skill.description,
      // Written by `validateSkillBody` on every publish; only null in
      // principle for a Kind that doesn't require one (ADR-0026), which a
      // Skill row never is.
      body: skill.body ?? "",
      license: payload.license,
      compatibility: payload.compatibility,
      metadata: payload.metadata,
      allowed_tools: payload.allowed_tools,
      published_at: skill.published_at,
      published_by: skill.published_by,
      tags,
      installs,
    };
  }

  /**
   * Validates and publishes a Skill, then returns a presigned URL to upload
   * its Artifact to.
   *
   * @remarks
   * Idempotent by `(kind, name)`: publishing an existing Skill replaces its
   * description and body, and the publisher and published-at become
   * whoever published it last (ADR-0002, amended by ADR-0026). The row is
   * written before the Artifact is uploaded, so between the two the Skill
   * lists and reads but its Artifact cannot yet be retrieved.
   *
   * `kind` is checked against `KINDS` (`@skill-registry/shared`) before
   * anything else: an unregistered Kind is refused here, naming the field,
   * rather than falling through to a 404 further down the route (ADR-0026).
   * `skill` is the only Kind registered so far, so this is also what makes
   * every other Kind name refused today.
   *
   * @param publisher - The authenticated User publishing the Skill.
   * @param rawKind - The Kind path segment, not yet known to be registered.
   * @param rawName - The Skill's name, taken from the request path and not
   * yet validated.
   * @param payload - The request body, expected to carry `description` and
   * `body`, and optionally `license`, `compatibility`, `metadata`, and
   * `allowed_tools`; not yet known to have any of them.
   * @returns `{ skill: SkillDetail; upload: SkillUpload }`
   * @throws ValidationError if `rawKind` doesn't name a registered Kind.
   * @throws SkillValidationError if `rawName`, `payload.description`,
   * `payload.body`, or any present optional field fails validation. A
   * failing optional field rejects the publish exactly like a failing
   * required one (ADR-0009) — nothing about the Skill changes.
   * @example
   * ```ts
   * const { skill, upload } = await resourcesService.publish(publisher, "skill", "my-skill", {
   *   description: "Does a thing.",
   *   body: "# my-skill\n...",
   * });
   * ```
   */
  async publish(
    publisher: UserRow,
    rawKind: string,
    rawName: string,
    payload: Record<string, unknown>,
  ): Promise<{ skill: SkillDetail; upload: SkillUpload }> {
    if (!isKind(rawKind)) {
      throw new ValidationError(`Unknown Kind "${rawKind}". Known: ${KIND_KEYS.join(", ")}.`, "kind");
    }
    // The only registered Kind, so `isKind` above already refused everything
    // else — this is Skill's own publish, unconditionally.
    const kind = "skill";

    // The caller parsed the name out of the SKILL.md frontmatter. The API does
    // not read the Artifact to confirm the two agree (ADR-0001).
    const name = validateSkillName(rawName);
    const description = validateSkillDescription(payload.description);
    const body = validateSkillBody(payload.body);
    // Coerced to `null`, not left `undefined`: a republish fully replaces the
    // frontmatter (ADR-0002), so a field the payload no longer sets must clear
    // what an earlier publish stored.
    const license = validateSkillLicense(payload.license) ?? null;
    const compatibility = validateSkillCompatibility(payload.compatibility) ?? null;
    const metadata = validateSkillMetadata(payload.metadata) ?? null;
    const allowed_tools = validateSkillAllowedTools(payload.allowed_tools) ?? null;
    const skillPayload: SkillPayload = { kind, license, compatibility, metadata, allowed_tools };

    // `tags` appears in neither the insert nor the conflict update: it is not a
    // column on `resources`, and no publish path writes it (ADR-0008, ADR-0011),
    // so a republish leaves a Skill's Tags as they were.
    const published_at = new Date();
    // Snapshotted like published_by_email: a display name the Resource list
    // and search can use without joining `users`, surviving a rename or
    // removal.
    const published_by_name = `${publisher.first_name} ${publisher.last_name}`;
    const upserted = await this.db
      .insert(resources)
      .values({
        kind,
        name,
        description,
        body,
        payload: skillPayload,
        published_by: publisher.id,
        published_by_email: publisher.email,
        published_by_name,
        published_at,
      })
      .onConflictDoUpdate({
        target: [resources.kind, resources.name],
        set: {
          description,
          body,
          payload: skillPayload,
          published_by: publisher.id,
          published_by_email: publisher.email,
          published_by_name,
          published_at,
          updated_at: new Date(),
        },
      })
      .returning();
    const row = firstRow(upserted, "Skill upsert");

    const url = await this.storage.presignUpload(artifactKey(row.id), {
      expiresInSeconds: ARTIFACT_UPLOAD_EXPIRY_SECONDS,
      contentType: ARTIFACT_CONTENT_TYPE,
    });

    this.logger.info({ skill_name: name, user_id: publisher.id }, "skill published");

    return {
      // Read back rather than assembled from `row` and `publisher`: one place
      // shapes a Skill, so a column added to `skillSelection` appears here
      // without this method being touched. A republish's Tags and install
      // count both survive untouched — publishing never writes `resource_tags`
      // or `resource_install_events`, and nothing but `refreshInstallCounts`
      // ever writes `resource_analytics` (ADR-0012); a brand new Skill simply
      // has neither yet.
      skill: await this.readSkill(eq(resources.id, row.id)),
      upload: {
        url,
        method: "PUT",
        headers: { "content-type": ARTIFACT_CONTENT_TYPE },
        expires_in_seconds: ARTIFACT_UPLOAD_EXPIRY_SECONDS,
      },
    };
  }

  /**
   * Permanently deletes a Resource and its Artifact.
   *
   * @remarks
   * Irreversible: no version history, no soft delete (ADR-0002). Existence is
   * checked up front so a missing Resource 404s before either delete runs.
   * The storage delete goes first because the API already tolerates a row
   * with no Artifact, but not an Artifact with no row.
   *
   * @param id - The Resource's id.
   * @throws ResourceNotFoundError if `id` is not a well-formed UUID, or no
   * Resource exists by it.
   * @throws ResourceDeleteFailedError if the storage or database delete
   * fails.
   */
  async remove(id: string): Promise<void> {
    await this.getNameOrThrow(id);

    try {
      await this.storage.delete(artifactKey(id));
      await this.db.delete(resources).where(eq(resources.id, id));
    } catch (cause) {
      throw new ResourceDeleteFailedError(cause);
    }

    this.logger.info({ resource_id: id }, "resource deleted");
  }

  /**
   * Presigns a short-lived URL to download a Resource's Artifact.
   *
   * @remarks
   * Unauthenticated, like every other read (ADR-0013). Counts as one Install
   * (ADR-0012) — the only point the API can observe a download, since the
   * Artifact transfers directly from storage. Recorded only once the Artifact
   * is confirmed to exist, so a 404 never inflates the count.
   *
   * @param id - The Resource's id.
   * @returns `string`
   * @throws ResourceNotFoundError if `id` is not a well-formed UUID, or no
   * Resource exists by it.
   * @throws ArtifactMissingError if the Resource's Artifact was never
   * uploaded.
   * @example
   * ```ts
   * const url = await resourcesService.getArtifactDownloadUrl(id);
   * ```
   */
  async getArtifactDownloadUrl(id: string): Promise<string> {
    const name = await this.getNameOrThrow(id);

    const key = artifactKey(id);
    if (!(await this.storage.exists(key))) throw new ArtifactMissingError();

    await this.analytics.recordInstall(id, "web");

    // The storage key is the Resource's id (docs/data-model.md), so without
    // this the browser's save dialog would default to `<uuid>.zip` — naming
    // the download after the key rather than the thing a person asked for.
    // `name` is already constrained to SKILL_NAME_PATTERN, so it's safe to
    // drop into the header unescaped.
    return this.storage.presignDownload(key, {
      expiresInSeconds: ARTIFACT_DOWNLOAD_EXPIRY_SECONDS,
      contentDisposition: `attachment; filename="${name}.zip"`,
    });
  }

  /**
   * A Resource's daily Install counts for the last `INSTALL_TREND_DAYS` days
   * — the Skill detail page's install trend chart.
   *
   * @param id - The Resource's id.
   * @returns One point per day, oldest first.
   * @throws ResourceNotFoundError if `id` is not a well-formed UUID, or no
   * Resource exists by it.
   * @example
   * ```ts
   * const trend = await resourcesService.getInstallTrend(id);
   * ```
   */
  async getInstallTrend(id: string): Promise<InstallTrendPoint[]> {
    await this.getNameOrThrow(id);
    return this.analytics.getInstallTimeseries(id, INSTALL_TREND_DAYS);
  }

  /**
   * Confirms a Resource exists by id, returning its name.
   *
   * @param id - The Resource's id.
   * @throws ResourceNotFoundError if `id` is not a well-formed UUID, or no
   * Resource exists by it.
   */
  private async getNameOrThrow(id: string): Promise<string> {
    const row = await selectByIdOrUndefined(() =>
      this.db.select({ name: resources.name }).from(resources).where(eq(resources.id, id)).limit(1),
    );
    if (!row) throw new ResourceNotFoundError();
    return row.name;
  }
}
