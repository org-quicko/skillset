import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Role } from "@skill-registry/shared";
import { eq } from "drizzle-orm";
import { hashPassword } from "../src/auth/password.js";
import { skills, users } from "../src/db/schema.js";
import { startTestContext, stopTestContext, type TestContext } from "./setup.js";

interface ApiPublisher {
  user_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

interface ApiSkill {
  name: string;
  description: string;
  body: string;
  published_by: ApiPublisher;
  published_at: string;
}

interface ApiPublished {
  skill: ApiSkill;
  upload: { url: string; method: string; headers: Record<string, string>; expires_in_seconds: number };
}

interface ApiPage {
  items: Array<Omit<ApiSkill, "body">>;
  page: number;
  page_size: number;
  total: number;
}

interface ApiError {
  error: { code: string; message: string; field?: string };
}

interface Session {
  cookie: string;
  email: string;
  id: string;
}

function sessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("Response did not set a session cookie.");
  const match = /session=([^;]*)/.exec(setCookie);
  if (!match) throw new Error(`Set-Cookie header missing "session": ${setCookie}`);
  return `session=${match[1]}`;
}

/**
 * Users other than the first are seeded through the database: creating one
 * is an Admin action that lands in ticket 11, and these tests need a reader
 * and a writer today. Logging in goes through the real route, so the session
 * under test is a genuine one.
 */
async function createUserAndLogIn(
  context: TestContext,
  body: { first_name: string; last_name: string; email: string; password: string; role: Role },
): Promise<Session> {
  const [row] = await context.db
    .insert(users)
    .values({
      first_name: body.first_name,
      last_name: body.last_name,
      email: body.email,
      password_hash: await hashPassword(body.password),
      role: body.role,
    })
    .returning();
  if (!row) throw new Error("Insert did not return the created User.");

  const res = await context.app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: body.email, password: body.password }),
  });
  if (res.status !== 200) throw new Error(`Login failed for ${body.email}: ${res.status}`);
  return { cookie: sessionCookie(res), email: body.email, id: row.id };
}

async function publish(
  context: TestContext,
  session: Session,
  name: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  return context.app.request(`/api/skills/${name}`, {
    method: "PUT",
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

const PASSWORD = "correct-horse-battery";

/**
 * Seam 1 — the API request boundary (spec, "Testing Decisions"): no server
 * listens; `app.request(...)` calls the Hono app directly against a real
 * Postgres and a fake storage adapter. The validation rules themselves are
 * covered as table-driven cases in the shared module; what is covered here
 * is everything that needs a request and a database.
 */
describe("Publishing and reading Skills (ticket 03)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;
  let admin: Session;
  let writer: Session;
  let reader: Session;

  beforeAll(async () => {
    const started = await startTestContext();
    container = started.container;
    context = started.context;

    const signUp = await context.app.request("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@example.com",
        password: PASSWORD,
      }),
    });
    admin = {
      cookie: sessionCookie(signUp),
      email: "ada@example.com",
      id: ((await signUp.json()) as { id: string }).id,
    };

    writer = await createUserAndLogIn(context, {
      first_name: "Grace",
      last_name: "Hopper",
      email: "grace@example.com",
      password: PASSWORD,
      role: "writer",
    });
    reader = await createUserAndLogIn(context, {
      first_name: "Margaret",
      last_name: "Hamilton",
      email: "margaret@example.com",
      password: PASSWORD,
      role: "reader",
    });
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  it("creates the Skill's row and returns where to write its Artifact", async () => {
    const res = await publish(context, writer, "code-review", {
      description: "Reviews code.",
      body: "# Review\n\nSteps here.\n",
    });
    expect(res.status).toBe(200);

    const published = (await res.json()) as ApiPublished;
    expect(published.skill.name).toBe("code-review");
    expect(published.skill.description).toBe("Reviews code.");
    expect(published.skill.published_by.email).toBe(writer.email);
    expect(published.upload.method).toBe("PUT");
    expect(published.upload.headers["content-type"]).toBe("application/zip");
    expect(published.upload.expires_in_seconds).toBeGreaterThan(0);
    // One object per Skill, keyed by its name.
    expect(decodeURIComponent(published.upload.url)).toContain("skills/code-review.zip");

    const [row] = await context.db.select().from(skills).where(eq(skills.name, "code-review")).limit(1);
    expect(row?.body).toBe("# Review\n\nSteps here.\n");
    expect(row?.published_by_email).toBe(writer.email);
  });

  it("refuses publishing to a reader and allows it to writers and Admins", async () => {
    const refused = await publish(context, reader, "reader-attempt", {
      description: "Should not land.",
      body: "Nope.\n",
    });
    expect(refused.status).toBe(403);

    const byAdmin = await publish(context, admin, "admin-published", {
      description: "Admins publish too.",
      body: "Body.\n",
    });
    expect(byAdmin.status).toBe(200);

    const anonymous = await context.app.request("/api/skills/anonymous-attempt", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "No session.", body: "Body.\n" }),
    });
    expect(anonymous.status).toBe(401);
  });

  it("replaces an existing Skill whoever published it first, and attributes it to whoever published it last", async () => {
    const first = await publish(context, writer, "shared-skill", {
      description: "First version.",
      body: "First body.\n",
    });
    const firstPublished = (await first.json()) as ApiPublished;

    const second = await publish(context, admin, "shared-skill", {
      description: "Second version.",
      body: "Second body.\n",
    });
    expect(second.status).toBe(200);
    const secondPublished = (await second.json()) as ApiPublished;

    expect(secondPublished.skill.published_by.email).toBe(admin.email);
    expect(new Date(secondPublished.skill.published_at).getTime()).toBeGreaterThanOrEqual(
      new Date(firstPublished.skill.published_at).getTime(),
    );

    const rows = await context.db.select().from(skills).where(eq(skills.name, "shared-skill"));
    expect(rows.length).toBe(1);
    expect(rows[0]?.description).toBe("Second version.");
    expect(rows[0]?.body).toBe("Second body.\n");
  });

  const rejections: Array<{ label: string; name: string; payload: Record<string, unknown>; code: string; field?: string }> = [
    {
      label: "a name that is not lowercase alphanumerics and hyphens",
      name: "Code_Review",
      payload: { description: "Reviews code.", body: "Body.\n" },
      code: "name_invalid",
      field: "name",
    },
    {
      label: "a missing description",
      name: "no-description",
      payload: { body: "Body.\n" },
      code: "description_required",
      field: "description",
    },
    {
      label: "a description over 1024 characters",
      name: "long-description",
      payload: { description: "d".repeat(1025), body: "Body.\n" },
      code: "description_too_long",
      field: "description",
    },
    {
      label: "an empty body",
      name: "no-body",
      payload: { description: "Reviews code.", body: "" },
      code: "body_required",
      field: "body",
    },
  ];

  for (const { label, name, payload, code, field } of rejections) {
    it(`rejects ${label}, naming the rule that failed`, async () => {
      const res = await publish(context, writer, name, payload);
      expect(res.status).toBe(400);
      const body = (await res.json()) as ApiError;
      expect(body.error.code).toBe(code);
      expect(body.error.field).toBe(field);

      const rows = await context.db.select().from(skills).where(eq(skills.name, name));
      expect(rows.length).toBe(0);
    });
  }

  it("reads a Skill by name, returning its description, body, publisher, and published-at", async () => {
    await publish(context, writer, "readable-skill", {
      description: "Readable.",
      body: "# Readable\n",
    });

    const res = await context.app.request("/api/skills/readable-skill", {
      headers: { cookie: reader.cookie },
    });
    expect(res.status).toBe(200);

    const skill = (await res.json()) as ApiSkill;
    expect(skill.name).toBe("readable-skill");
    expect(skill.description).toBe("Readable.");
    expect(skill.body).toBe("# Readable\n");
    expect(skill.published_by).toEqual({
      user_id: writer.id,
      email: writer.email,
      first_name: "Grace",
      last_name: "Hopper",
    });
    expect(Number.isNaN(new Date(skill.published_at).getTime())).toBe(false);
  });

  it("returns 404 for a Skill that does not exist, and refuses reads without a session", async () => {
    const missing = await context.app.request("/api/skills/no-such-skill", {
      headers: { cookie: reader.cookie },
    });
    expect(missing.status).toBe(404);

    const anonymous = await context.app.request("/api/skills/readable-skill");
    expect(anonymous.status).toBe(401);
  });

  it("keeps attribution after the publishing User is removed", async () => {
    const departing = await createUserAndLogIn(context, {
      first_name: "Katherine",
      last_name: "Johnson",
      email: "katherine@example.com",
      password: PASSWORD,
      role: "writer",
    });
    await publish(context, departing, "orphaned-skill", {
      description: "Published by someone since removed.",
      body: "Body.\n",
    });

    await context.db.delete(users).where(eq(users.id, departing.id));

    const res = await context.app.request("/api/skills/orphaned-skill", {
      headers: { cookie: reader.cookie },
    });
    const skill = (await res.json()) as ApiSkill;
    expect(skill.published_by).toEqual({
      user_id: null,
      email: "katherine@example.com",
      first_name: null,
      last_name: null,
    });
  });
});

describe("Listing Skills (ticket 03)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;
  let reader: Session;

  beforeAll(async () => {
    const started = await startTestContext();
    container = started.container;
    context = started.context;

    await context.app.request("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@example.com",
        password: PASSWORD,
      }),
    });
    reader = await createUserAndLogIn(context, {
      first_name: "Margaret",
      last_name: "Hamilton",
      email: "margaret@example.com",
      password: PASSWORD,
      role: "reader",
    });

    // 51 Skills, one page and one over. Seeded directly with distinct
    // publication times — publishing itself is covered above; what is under
    // test here is order and pagination.
    const base = Date.UTC(2026, 0, 1);
    await context.db.insert(skills).values(
      Array.from({ length: 51 }, (_, index) => ({
        name: `skill-${String(index).padStart(3, "0")}`,
        description: `Skill number ${index}.`,
        body: "Body.\n",
        published_by: null,
        published_by_email: "ada@example.com",
        published_at: new Date(base + index * 60_000),
      })),
    );
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  it("returns the most recently published first, 50 to a page", async () => {
    const res = await context.app.request("/api/skills", { headers: { cookie: reader.cookie } });
    expect(res.status).toBe(200);

    const page = (await res.json()) as ApiPage;
    expect(page.page).toBe(1);
    expect(page.page_size).toBe(50);
    expect(page.total).toBe(51);
    expect(page.items.length).toBe(50);
    expect(page.items[0]?.name).toBe("skill-050");
    expect(page.items[49]?.name).toBe("skill-001");
  });

  it("serves the rest on the next page", async () => {
    const res = await context.app.request("/api/skills?page=2", { headers: { cookie: reader.cookie } });
    const page = (await res.json()) as ApiPage;
    expect(page.page).toBe(2);
    expect(page.items.length).toBe(1);
    expect(page.items[0]?.name).toBe("skill-000");
  });

  it("treats a page beyond the end as empty rather than an error", async () => {
    const res = await context.app.request("/api/skills?page=99", { headers: { cookie: reader.cookie } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ApiPage).items).toEqual([]);
  });

  it("refuses listing without a session", async () => {
    const res = await context.app.request("/api/skills");
    expect(res.status).toBe(401);
  });
});

/**
 * Seam 1 again: the redirect target itself is a presigned URL from the fake
 * storage adapter, not something a request test asserts the shape of — what
 * is under test is who gets redirected at all, and what happens when the
 * Artifact behind the row was never written.
 */
describe("Downloading a Skill's Artifact (ticket 08)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;
  let writer: Session;
  let reader: Session;

  beforeAll(async () => {
    const started = await startTestContext();
    container = started.container;
    context = started.context;

    await context.app.request("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@example.com",
        password: PASSWORD,
      }),
    });
    writer = await createUserAndLogIn(context, {
      first_name: "Grace",
      last_name: "Hopper",
      email: "grace@example.com",
      password: PASSWORD,
      role: "writer",
    });
    reader = await createUserAndLogIn(context, {
      first_name: "Margaret",
      last_name: "Hamilton",
      email: "margaret@example.com",
      password: PASSWORD,
      role: "reader",
    });
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  it("redirects a reader to a short-lived presigned location named after the Skill", async () => {
    await publish(context, writer, "downloadable-skill", {
      description: "Has an Artifact.",
      body: "Body.\n",
    });
    await context.storage.put("skills/downloadable-skill.zip", new Uint8Array([1, 2, 3]));

    const res = await context.app.request("/api/skills/downloadable-skill/artifact", {
      headers: { cookie: reader.cookie },
      redirect: "manual",
    });
    expect(res.status).toBe(302);

    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    expect(decodeURIComponent(location ?? "")).toContain("skills/downloadable-skill.zip");
  });

  it("refuses an unauthenticated request", async () => {
    await publish(context, writer, "another-downloadable-skill", {
      description: "Has an Artifact too.",
      body: "Body.\n",
    });
    await context.storage.put("skills/another-downloadable-skill.zip", new Uint8Array([1]));

    const res = await context.app.request("/api/skills/another-downloadable-skill/artifact", {
      redirect: "manual",
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 for a Skill that does not exist", async () => {
    const res = await context.app.request("/api/skills/no-such-skill/artifact", {
      headers: { cookie: reader.cookie },
      redirect: "manual",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("not_found");
  });

  it("fails comprehensibly when the Skill's row exists but its Artifact was never uploaded", async () => {
    await publish(context, writer, "abandoned-skill", {
      description: "The upload after this never happened.",
      body: "Body.\n",
    });

    const res = await context.app.request("/api/skills/abandoned-skill/artifact", {
      headers: { cookie: reader.cookie },
      redirect: "manual",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("artifact_missing");
  });
});

/**
 * Seam 1 again: an Admin-only, irreversible action (spec, ticket 12).
 */
describe("Deleting a Skill (ticket 12)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;
  let admin: Session;
  let writer: Session;
  let reader: Session;

  beforeAll(async () => {
    const started = await startTestContext();
    container = started.container;
    context = started.context;

    const signUp = await context.app.request("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@example.com",
        password: PASSWORD,
      }),
    });
    admin = { cookie: sessionCookie(signUp), email: "ada@example.com", id: ((await signUp.json()) as { id: string }).id };

    writer = await createUserAndLogIn(context, {
      first_name: "Grace",
      last_name: "Hopper",
      email: "grace@example.com",
      password: PASSWORD,
      role: "writer",
    });
    reader = await createUserAndLogIn(context, {
      first_name: "Margaret",
      last_name: "Hamilton",
      email: "margaret@example.com",
      password: PASSWORD,
      role: "reader",
    });
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  it("removes the row and the Artifact, and frees the name for publishing again", async () => {
    await publish(context, writer, "doomed-skill", {
      description: "About to go.",
      body: "Body.\n",
    });
    await context.storage.put("skills/doomed-skill.zip", new Uint8Array([1, 2, 3]));

    const res = await context.app.request("/api/skills/doomed-skill", {
      method: "DELETE",
      headers: { cookie: admin.cookie },
    });
    expect(res.status).toBe(204);

    const rows = await context.db.select().from(skills).where(eq(skills.name, "doomed-skill"));
    expect(rows.length).toBe(0);
    expect(await context.storage.exists("skills/doomed-skill.zip")).toBe(false);

    const missing = await context.app.request("/api/skills/doomed-skill", { headers: { cookie: reader.cookie } });
    expect(missing.status).toBe(404);

    const republished = await publish(context, writer, "doomed-skill", {
      description: "Back again.",
      body: "New body.\n",
    });
    expect(republished.status).toBe(200);
  });

  it("succeeds even when the Artifact behind the row was never uploaded", async () => {
    await publish(context, writer, "never-uploaded-skill", {
      description: "The upload never happened.",
      body: "Body.\n",
    });

    const res = await context.app.request("/api/skills/never-uploaded-skill", {
      method: "DELETE",
      headers: { cookie: admin.cookie },
    });
    expect(res.status).toBe(204);

    const rows = await context.db.select().from(skills).where(eq(skills.name, "never-uploaded-skill"));
    expect(rows.length).toBe(0);
  });

  it("refuses readers and writers, allowing only Admins", async () => {
    await publish(context, writer, "protected-skill", {
      description: "Not going anywhere yet.",
      body: "Body.\n",
    });

    const byReader = await context.app.request("/api/skills/protected-skill", {
      method: "DELETE",
      headers: { cookie: reader.cookie },
    });
    expect(byReader.status).toBe(403);

    const byWriter = await context.app.request("/api/skills/protected-skill", {
      method: "DELETE",
      headers: { cookie: writer.cookie },
    });
    expect(byWriter.status).toBe(403);

    const anonymous = await context.app.request("/api/skills/protected-skill", { method: "DELETE" });
    expect(anonymous.status).toBe(401);

    const rows = await context.db.select().from(skills).where(eq(skills.name, "protected-skill"));
    expect(rows.length).toBe(1);
  });

  it("returns 404 for a Skill that does not exist", async () => {
    const res = await context.app.request("/api/skills/no-such-skill", {
      method: "DELETE",
      headers: { cookie: admin.cookie },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("not_found");
  });
});
