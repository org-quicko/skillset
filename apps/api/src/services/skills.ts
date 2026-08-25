import {
  SKILL_PAGE_SIZE,
  validateSkillAllowedTools,
  validateSkillBody,
  validateSkillCompatibility,
  validateSkillDescription,
  validateSkillLicense,
  validateSkillMetadata,
  validateSkillName,
} from "@skill-registry/shared";
import { count, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { skills, users, type UserRow } from "../db/schema.js";
import { ArtifactMissingError, SkillDeleteFailedError, SkillNotFoundError } from "../http/errors.js";
import type { Logger } from "../logger.js";
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
  name: skills.name,
  description: skills.description,
  body: skills.body,
  license: skills.license,
  compatibility: skills.compatibility,
  metadata: skills.metadata,
  allowed_tools: skills.allowed_tools,
  tags: skills.tags,
  published_at: skills.published_at,
  published_by: {
    user_id: users.id,
    email: skills.published_by_email,
    first_name: users.first_name,
    last_name: users.last_name,
  },
};

/** The wire's `tags` is never null — a Skill with none simply has an empty list. */
function normalizeTags(tags: string[] | null): string[] {
  return tags ?? [];
}

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
  name: string;
  description: string;
  license: string | null;
  compatibility: string | null;
  metadata: Record<string, string> | null;
  allowed_tools: string | null;
  tags: string[];
  published_at: Date;
  published_by: SkillPublisher;
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

/** A page below 1 — or not a number at all — is the first page, not an error. */
function parsePage(raw: string | undefined): number {
  const page = Number(raw ?? "1");
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** A blank or all-whitespace search term is treated as no search term at all. */
function parseQuery(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

async function assertSkillExists(deps: SkillsServiceDependencies, name: string): Promise<void> {
  const [skill] = await deps.db.select({ name: skills.name }).from(skills).where(eq(skills.name, name)).limit(1);
  if (!skill) throw new SkillNotFoundError();
}

/**
 * Lists Skills, newest-published first, one page at a time, optionally
 * narrowed by a full-text search term.
 *
 * @remarks
 * A search term is matched against the generated `search` column with
 * Postgres's web-search query parser (`websearch_to_tsquery`), which accepts
 * a plain phrase, `"quoted phrases"`, and `-exclusions`
 * (docs/adr/0004-postgres-over-sqlite.md). It stems rather than
 * substring-matches — `postgres` will not find `postgresql` — and hyphenated
 * identifiers tokenise per word, so an unquoted hyphenated term matches any
 * Skill containing all of its words, not just the one it names. A blank or
 * missing term is treated as no search at all, so this doubles as the
 * ordinary list endpoint.
 *
 * @param deps - The database this reads from.
 * @param rawPage - The requested page number, as a string straight from a
 * query parameter. Anything below 1, or not a number at all, is treated as
 * the first page.
 * @param rawQuery - The raw `q` query-string parameter, or `undefined` when
 * it is absent. Trimmed before use; blank after trimming is treated as no
 * search term.
 * @returns The matching page of Skills, alongside the page number, page
 * size, and the total count of matches (not the unfiltered table).
 * @example
 * ```ts
 * // GET /skills?q=%22code%20review%22%20-legacy&page=2
 * await listSkills(deps, "2", '"code review" -legacy');
 * ```
 */
export async function listSkills(
  deps: SkillsServiceDependencies,
  rawPage: string | undefined,
  rawQuery?: string,
): Promise<{ items: SkillSummary[]; page: number; page_size: number; total: number }> {
  const page = parsePage(rawPage);
  const query = parseQuery(rawQuery);
  const matches = query ? sql`${skills.search} @@ websearch_to_tsquery('english', ${query})` : undefined;

  const rows = await deps.db
    .select({
      name: skillSelection.name,
      description: skillSelection.description,
      license: skillSelection.license,
      compatibility: skillSelection.compatibility,
      metadata: skillSelection.metadata,
      allowed_tools: skillSelection.allowed_tools,
      tags: skillSelection.tags,
      published_at: skillSelection.published_at,
      published_by: skillSelection.published_by,
    })
    .from(skills)
    .leftJoin(users, eq(skills.published_by, users.id))
    .where(matches)
    .orderBy(desc(skills.published_at))
    .limit(SKILL_PAGE_SIZE)
    .offset((page - 1) * SKILL_PAGE_SIZE);

  const items = rows.map((row) => ({ ...row, tags: normalizeTags(row.tags) }));

  const [totals] = await deps.db.select({ total: count() }).from(skills).where(matches);

  return { items, page, page_size: SKILL_PAGE_SIZE, total: totals?.total ?? 0 };
}

/**
 * Reads a single Skill by its exact name.
 *
 * @remarks
 * An exact-name read against the primary key. Full-text search is a
 * different route's job — a lookup by name never goes through it.
 *
 * @param deps - The database this reads from.
 * @param name - The Skill's name.
 * @returns `SkillDetail`
 * @throws SkillNotFoundError if no Skill exists by that name.
 */
export async function getSkill(deps: SkillsServiceDependencies, name: string): Promise<SkillDetail> {
  const [skill] = await deps.db
    .select(skillSelection)
    .from(skills)
    .leftJoin(users, eq(skills.published_by, users.id))
    .where(eq(skills.name, name))
    .limit(1);

  if (!skill) throw new SkillNotFoundError();
  return { ...skill, tags: normalizeTags(skill.tags) };
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
  // published it last (ADR-0002). `tags` is deliberately absent from both
  // the insert and the conflict update — no publish path ever writes it
  // (ADR-0008), so a replace leaves it exactly as it was.
  const published_at = new Date();
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
        published_at,
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
      name: row.name,
      description: row.description,
      body: row.body,
      license: row.license,
      compatibility: row.compatibility,
      metadata: row.metadata,
      allowed_tools: row.allowed_tools,
      tags: normalizeTags(row.tags),
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
 * @param name - The Skill's name.
 * @throws SkillNotFoundError if no Skill exists by that name.
 * @throws SkillDeleteFailedError if the storage or database delete fails.
 */
export async function deleteSkill(deps: SkillsServiceDependencies, name: string): Promise<void> {
  await assertSkillExists(deps, name);

  try {
    await deps.storage.delete(artifactKey(name));
    await deps.db.delete(skills).where(eq(skills.name, name));
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
 *
 * @param deps - The database and storage adapter this needs.
 * @param name - The Skill's name.
 * @returns `string`
 * @throws SkillNotFoundError if no Skill exists by that name.
 * @throws ArtifactMissingError if the Skill's Artifact was never uploaded.
 */
export async function getArtifactDownloadUrl(deps: SkillsServiceDependencies, name: string): Promise<string> {
  await assertSkillExists(deps, name);

  const key = artifactKey(name);
  if (!(await deps.storage.exists(key))) throw new ArtifactMissingError();

  return deps.storage.presignDownload(key, { expiresInSeconds: ARTIFACT_DOWNLOAD_EXPIRY_SECONDS });
}
