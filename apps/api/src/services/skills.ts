import {
  SKILL_PAGE_SIZE,
  validateSkillBody,
  validateSkillDescription,
  validateSkillName,
} from "@skill-registry/shared";
import { count, desc, eq } from "drizzle-orm";
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
  published_at: skills.published_at,
  published_by: {
    user_id: users.id,
    email: skills.published_by_email,
    first_name: users.first_name,
    last_name: users.last_name,
  },
};

/** A page below 1 — or not a number at all — is the first page, not an error. */
function parsePage(raw: string | undefined): number {
  const page = Number(raw ?? "1");
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

async function assertSkillExists(deps: SkillsServiceDependencies, name: string): Promise<void> {
  const [skill] = await deps.db.select({ name: skills.name }).from(skills).where(eq(skills.name, name)).limit(1);
  if (!skill) throw new SkillNotFoundError();
}

export async function listSkills(deps: SkillsServiceDependencies, rawPage: string | undefined) {
  const page = parsePage(rawPage);

  const items = await deps.db
    .select({
      name: skillSelection.name,
      description: skillSelection.description,
      published_at: skillSelection.published_at,
      published_by: skillSelection.published_by,
    })
    .from(skills)
    .leftJoin(users, eq(skills.published_by, users.id))
    .orderBy(desc(skills.published_at))
    .limit(SKILL_PAGE_SIZE)
    .offset((page - 1) * SKILL_PAGE_SIZE);

  const [totals] = await deps.db.select({ total: count() }).from(skills);

  return { items, page, page_size: SKILL_PAGE_SIZE, total: totals?.total ?? 0 };
}

// An exact-name read against the primary key. Full-text search is a
// different route's job — a lookup by name never goes through it.
export async function getSkill(deps: SkillsServiceDependencies, name: string) {
  const [skill] = await deps.db
    .select(skillSelection)
    .from(skills)
    .leftJoin(users, eq(skills.published_by, users.id))
    .where(eq(skills.name, name))
    .limit(1);

  if (!skill) throw new SkillNotFoundError();
  return skill;
}

export async function publishSkill(
  deps: SkillsServiceDependencies,
  publisher: UserRow,
  rawName: string,
  payload: Record<string, unknown> | null,
) {
  // The name comes from the path; the caller parsed it out of the SKILL.md
  // frontmatter. Validated here against the same rules the shared module
  // applies — the API does not read the Artifact to confirm the two agree
  // (ADR-0001). A `SkillValidationError` here bubbles to the central error
  // handler unchanged.
  const name = validateSkillName(rawName);
  const description = validateSkillDescription(payload?.description);
  const body = validateSkillBody(payload?.body);

  // Idempotent by name: publishing an existing Skill replaces it whoever
  // published it first, and the publisher and published-at become whoever
  // published it last (ADR-0002).
  const published_at = new Date();
  const [row] = await deps.db
    .insert(skills)
    .values({
      name,
      description,
      body,
      published_by: publisher.id,
      published_by_email: publisher.email,
      published_at,
    })
    .onConflictDoUpdate({
      target: skills.name,
      set: {
        description,
        body,
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

// Irreversible (spec: the one action withheld from writers) — no version
// history, no soft delete (ADR-0002). Existence is checked up front so a
// missing Skill 404s before either delete runs; the storage delete happens
// first because a dangling row with no Artifact is a state the API already
// tolerates (a Skill whose Artifact was never uploaded), while a dangling
// Artifact for a row that no longer exists is not.
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

// Any authenticated User may retrieve an Artifact — reader is the base
// role, so the route's requireAuth alone is the whole authorisation check.
// The key is named after the Skill (storage/keys.ts), so the presigned
// location's own path already ends in the filename a download should have;
// nothing else names it.
export async function getArtifactDownloadUrl(deps: SkillsServiceDependencies, name: string): Promise<string> {
  await assertSkillExists(deps, name);

  const key = artifactKey(name);
  if (!(await deps.storage.exists(key))) throw new ArtifactMissingError();

  return deps.storage.presignDownload(key, { expiresInSeconds: ARTIFACT_DOWNLOAD_EXPIRY_SECONDS });
}
