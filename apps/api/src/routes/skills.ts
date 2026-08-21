import {
  SKILL_PAGE_SIZE,
  SkillPageSchema,
  SkillPublishedSchema,
  SkillSchema,
  SkillValidationError,
  validateSkillBody,
  validateSkillDescription,
  validateSkillName,
} from "@skill-registry/shared";
import { count, desc, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { requireAuth, requireRole, type AuthDependencies, type AuthVariables } from "../auth/middleware.js";
import { skills, users } from "../db/schema.js";
import { errorResponse } from "../http/errors.js";
import {
  ARTIFACT_CONTENT_TYPE,
  ARTIFACT_UPLOAD_EXPIRY_SECONDS,
  artifactKey,
} from "../storage/keys.js";
import type { StorageAdapter } from "../storage/types.js";

export interface SkillRouteDependencies extends AuthDependencies {
  storage: StorageAdapter;
}

/**
 * The wire's `published_by` is the Publisher object, not the column: the
 * email snapshot on the Skill row is always present, while the id and names
 * come from the User row and are null once that User has been removed
 * (docs/data-model.md). Selecting it in this shape is what lets a route
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

function validationFailed(c: Context, error: SkillValidationError) {
  return errorResponse(c, 400, error.rule, error.message, error.field);
}

function skillNotFound(c: Context) {
  return errorResponse(c, 404, "not_found", "No Skill by that name.");
}

export function registerSkillsRoutes(app: Hono<{ Variables: AuthVariables }>, deps: SkillRouteDependencies): void {
  app.get("/skills", requireAuth(deps), async (c) => {
    const page = parsePage(c.req.query("page"));

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

    return c.json(
      SkillPageSchema.parse({ items, page, page_size: SKILL_PAGE_SIZE, total: totals?.total ?? 0 }),
    );
  });

  // An exact-name read against the primary key. Full-text search is a
  // different route's job — a lookup by name never goes through it.
  app.get("/skills/:name", requireAuth(deps), async (c) => {
    const [skill] = await deps.db
      .select(skillSelection)
      .from(skills)
      .leftJoin(users, eq(skills.published_by, users.id))
      .where(eq(skills.name, c.req.param("name")))
      .limit(1);

    if (!skill) return skillNotFound(c);
    return c.json(SkillSchema.parse(skill));
  });

  app.put("/skills/:name", requireAuth(deps), requireRole("writer", "admin"), async (c) => {
    const publisher = c.get("user");

    let name: string;
    let description: string;
    let body: string;
    try {
      // The name comes from the path; the caller parsed it out of the
      // SKILL.md frontmatter. Validated here against the same rules the
      // shared module applies — the API does not read the Artifact to
      // confirm the two agree (ADR-0001).
      name = validateSkillName(c.req.param("name"));
      const payload = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
      description = validateSkillDescription(payload?.description);
      body = validateSkillBody(payload?.body);
    } catch (error) {
      if (error instanceof SkillValidationError) return validationFailed(c, error);
      throw error;
    }

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

    return c.json(
      SkillPublishedSchema.parse({
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
      }),
    );
  });
}
