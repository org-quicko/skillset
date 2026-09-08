import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { extractSkillFiles, type Role } from "@skillset/shared";
import { asc, eq } from "drizzle-orm";
import { setPasswordCredential } from "../src/auth/credential.js";
import { hashPassword } from "../src/auth/password.js";
import { resourceInstallEvents, resources, users } from "../src/db/schemas/index.js";
import {
  refreshInstallCounts,
  SIGN_IN_PATH,
  startTestContext,
  stopTestContext,
  type TestContext,
  SESSION_COOKIE_NAME,
} from "./setup.js";

interface ApiPublisher {
  user_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

interface ApiTag {
  id: string;
  name: string;
}

interface ApiSkill {
  id: string;
  name: string;
  description: string;
  body: string;
  license: string | null;
  compatibility: string | null;
  metadata: Record<string, string> | null;
  allowed_tools: string | null;
  tags: ApiTag[];
  published_by: ApiPublisher;
  published_at: string;
}

interface ApiUploadTarget {
  path: string;
  url: string;
  method: string;
  headers: Record<string, string>;
}

interface ApiPublished {
  skill: ApiSkill;
  upload: { files: ApiUploadTarget[]; expires_in_seconds: number };
}

/** `GET /resources/{id}/files`'s shape. */
interface ApiManifest {
  files: { path: string; size: number }[];
}

/** `GET /resources`'s row shape (ticket 23) — distinct from `ApiSkill`: `published_by_name` and `updated_at`, not the full Publisher and `published_at`. */
interface ApiDirectoryEntry {
  id: string;
  name: string;
  description: string;
  published_by_name: string;
  updated_at: string;
  installs: number;
  tags: ApiTag[];
}

interface ApiPage {
  items: ApiDirectoryEntry[];
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

/** A Skill's `payload` (ADR-0026) with none of the four optional fields set — what a raw seed row not going through `publish` needs. */
const BLANK_SKILL_PAYLOAD = { kind: "skill", license: null, compatibility: null, metadata: null, allowed_tools: null };

function sessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("Response did not set a session cookie.");
  const match = new RegExp(`${SESSION_COOKIE_NAME}=([^;]*)`).exec(setCookie);
  if (!match) throw new Error(`Set-Cookie header missing "${SESSION_COOKIE_NAME}": ${setCookie}`);
  return `${SESSION_COOKIE_NAME}=${match[1]}`;
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
      role: body.role,
    })
    .returning();
  if (!row) throw new Error("Insert did not return the created User.");

  await setPasswordCredential(context.db, row.id, await hashPassword(body.password));

  const res = await context.app.request(SIGN_IN_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: body.email, password: body.password }),
  });
  if (res.status !== 200) throw new Error(`Login failed for ${body.email}: ${res.status}`);
  return { cookie: sessionCookie(res), email: body.email, id: row.id };
}

/**
 * Publishes a Skill. `files` defaults to a single `SKILL.md`, since a publish
 * needs a manifest (ADR-0032) and almost every test here is about something
 * else — a case that cares passes its own.
 */
async function publish(
  context: TestContext,
  session: Session,
  name: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  return context.app.request(`/api/resources/skill/${name}`, {
    method: "PUT",
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ files: [{ path: "SKILL.md", size: 6 }], ...payload }),
  });
}

/**
 * Writes an Artifact's files where the API reads them from, standing in for
 * the presigned uploads a real publisher would make (ADR-0001: they never go
 * through the API, so no request here can make them happen).
 */
async function putArtifact(context: TestContext, id: string, files: Record<string, string>): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    await context.storage.put(`resources/${id}/${path}`, new TextEncoder().encode(contents));
  }
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
    expect(published.upload.expires_in_seconds).toBeGreaterThan(0);
    expect(published.upload.files).toHaveLength(1);
    const [target] = published.upload.files;
    expect(target?.path).toBe("SKILL.md");
    expect(target?.method).toBe("PUT");
    expect(target?.headers["content-type"]).toBe("application/octet-stream");
    // One object per file, under a prefix keyed by the Resource's id
    // (ADR-0026, ADR-0032).
    expect(decodeURIComponent(target?.url ?? "")).toContain(`resources/${published.skill.id}/SKILL.md`);

    const [row] = await context.db.select().from(resources).where(eq(resources.name, "code-review")).limit(1);
    expect(row?.id).toBe(published.skill.id);
    expect(row?.body).toBe("# Review\n\nSteps here.\n");
    expect(row?.published_by_email).toBe(writer.email);
  });

  it("returns the same Skill a read of it returns", async () => {
    // The publish response used to be assembled by hand, column by column,
    // separately from every read path. Nothing failed if a new column reached
    // the insert and not that literal — the Skill would simply be missing a
    // field until the next GET. Both now come from one place, and this is what
    // says so: an exhaustive comparison, not a field-by-field spot check.
    const res = await publish(context, writer, "echoed-skill", {
      description: "Published and read back.",
      body: "# Echo\n",
      license: "MIT",
      compatibility: "Claude Code",
      allowed_tools: "Read, Grep",
      metadata: { team: "platform" },
    });
    expect(res.status).toBe(200);
    const published = (await res.json()) as ApiPublished;

    const read = await context.app.request(`/api/resources/${published.skill.id}`);
    expect(read.status).toBe(200);

    expect(published.skill).toEqual((await read.json()) as ApiSkill);
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

    const anonymous = await context.app.request("/api/resources/skill/anonymous-attempt", {
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
    // Generated once, on first insert, and never changes across republishes
    // of the same name (ticket 16).
    expect(secondPublished.skill.id).toBe(firstPublished.skill.id);

    const rows = await context.db.select().from(resources).where(eq(resources.name, "shared-skill"));
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
    {
      label: "an empty license",
      name: "bad-license",
      payload: { description: "Reviews code.", body: "Body.\n", license: "" },
      code: "license_invalid",
      field: "license",
    },
    {
      label: "a compatibility note that is not a string",
      name: "bad-compatibility-type",
      payload: { description: "Reviews code.", body: "Body.\n", compatibility: 42 },
      code: "compatibility_invalid",
      field: "compatibility",
    },
    {
      label: "a compatibility note over 500 characters",
      name: "bad-compatibility",
      payload: { description: "Reviews code.", body: "Body.\n", compatibility: "c".repeat(501) },
      code: "compatibility_too_long",
      field: "compatibility",
    },
    {
      label: "metadata with a non-string value",
      name: "bad-metadata",
      payload: { description: "Reviews code.", body: "Body.\n", metadata: { version: 1 } },
      code: "metadata_invalid",
      field: "metadata",
    },
    {
      label: "allowed-tools that is not a string",
      name: "bad-allowed-tools",
      payload: { description: "Reviews code.", body: "Body.\n", allowed_tools: ["Read"] },
      code: "allowed_tools_invalid",
      field: "allowed_tools",
    },
  ];

  for (const { label, name, payload, code, field } of rejections) {
    it(`rejects ${label}, naming the rule that failed`, async () => {
      const res = await publish(context, writer, name, payload);
      expect(res.status).toBe(400);
      const body = (await res.json()) as ApiError;
      expect(body.error.code).toBe(code);
      expect(body.error.field).toBe(field);

      const rows = await context.db.select().from(resources).where(eq(resources.name, name));
      expect(rows.length).toBe(0);
    });
  }

  it("rejects publishing an unregistered kind, naming the field rather than 404ing", async () => {
    const res = await context.app.request("/api/resources/mcp-server/unregistered-kind-attempt", {
      method: "PUT",
      headers: { cookie: writer.cookie, "content-type": "application/json" },
      body: JSON.stringify({ description: "Reviews code.", body: "Body.\n" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.field).toBe("kind");
  });

  it("reads a Skill by id, returning its description, body, publisher, and published-at", async () => {
    const published = await publish(context, writer, "readable-skill", {
      description: "Readable.",
      body: "# Readable\n",
    });
    const { skill: publishedSkill } = (await published.json()) as ApiPublished;

    const res = await context.app.request(`/api/resources/${publishedSkill.id}`, {
      headers: { cookie: reader.cookie },
    });
    expect(res.status).toBe(200);

    const skill = (await res.json()) as ApiSkill;
    expect(skill.id).toBe(publishedSkill.id);
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

  it("leaves license, compatibility, metadata, and allowed-tools null, and tags empty, when a publish never sets them", async () => {
    const published = await publish(context, writer, "bare-skill", { description: "No extras.", body: "Body.\n" });
    const { skill: publishedSkill } = (await published.json()) as ApiPublished;

    const res = await context.app.request(`/api/resources/${publishedSkill.id}`, { headers: { cookie: reader.cookie } });
    const skill = (await res.json()) as ApiSkill;
    expect(skill.license).toBeNull();
    expect(skill.compatibility).toBeNull();
    expect(skill.metadata).toBeNull();
    expect(skill.allowed_tools).toBeNull();
    expect(skill.tags).toEqual([]);
  });

  it("round-trips license, compatibility, metadata, and allowed-tools when a publish sets all four", async () => {
    const published = await publish(context, writer, "full-frontmatter-skill", {
      description: "Has every optional field.",
      body: "Body.\n",
      license: "Apache-2.0",
      compatibility: "Requires git and jq.",
      metadata: { author: "quicko", version: "1.0" },
      allowed_tools: "Bash(git:*) Read",
    });
    const { skill: publishedSkill } = (await published.json()) as ApiPublished;

    const res = await context.app.request(`/api/resources/${publishedSkill.id}`, { headers: { cookie: reader.cookie } });
    const skill = (await res.json()) as ApiSkill;
    expect(skill.license).toBe("Apache-2.0");
    expect(skill.compatibility).toBe("Requires git and jq.");
    expect(skill.metadata).toEqual({ author: "quicko", version: "1.0" });
    expect(skill.allowed_tools).toBe("Bash(git:*) Read");

    const [row] = await context.db.select().from(resources).where(eq(resources.name, "full-frontmatter-skill"));
    const payload = row?.payload as { license: string | null; metadata: Record<string, string> | null } | undefined;
    expect(payload?.license).toBe("Apache-2.0");
    expect(payload?.metadata).toEqual({ author: "quicko", version: "1.0" });
  });

  it("clears an optional field on republish when the new payload no longer sets it", async () => {
    await publish(context, writer, "shrinking-skill", {
      description: "Had a license once.",
      body: "Body.\n",
      license: "MIT",
    });

    const second = await publish(context, writer, "shrinking-skill", {
      description: "Lost its license.",
      body: "Body.\n",
    });
    const { skill: publishedSkill } = (await second.json()) as ApiPublished;

    const res = await context.app.request(`/api/resources/${publishedSkill.id}`, { headers: { cookie: reader.cookie } });
    expect(((await res.json()) as ApiSkill).license).toBeNull();
  });

  it("leaves tags untouched when republishing, since no publish path ever writes them", async () => {
    const published = await publish(context, writer, "tagged-skill", { description: "Has tags already.", body: "Body.\n" });
    const { skill: publishedSkill } = (await published.json()) as ApiPublished;

    await context.app.request(`/api/resources/${publishedSkill.id}/tags`, {
      method: "PUT",
      headers: { cookie: writer.cookie, "content-type": "application/json" },
      body: JSON.stringify({ tags: ["testing", "example"] }),
    });

    const republished = await publish(context, admin, "tagged-skill", {
      description: "Republished by someone else.",
      body: "New body.\n",
    });
    const { skill: republishedSkill } = (await republished.json()) as ApiPublished;

    const res = await context.app.request(`/api/resources/${republishedSkill.id}`, { headers: { cookie: reader.cookie } });
    const skill = (await res.json()) as ApiSkill;
    expect(skill.description).toBe("Republished by someone else.");
    expect(skill.tags.map((tag) => tag.name).sort()).toEqual(["example", "testing"]);
  });

  it("returns 404 for a Skill that does not exist, and serves reads without a session", async () => {
    const missing = await context.app.request(`/api/resources/${crypto.randomUUID()}`, {
      headers: { cookie: reader.cookie },
    });
    expect(missing.status).toBe(404);

    const published = await publish(context, writer, "anonymous-read-attempt", {
      description: "Read without a session.",
      body: "Body.\n",
    });
    const { skill: publishedSkill } = (await published.json()) as ApiPublished;

    // Reads need no session or Token (ADR-0013).
    const anonymous = await context.app.request(`/api/resources/${publishedSkill.id}`);
    expect(anonymous.status).toBe(200);
    expect(((await anonymous.json()) as ApiSkill).name).toBe("anonymous-read-attempt");
  });

  it("returns 404 for a malformed id", async () => {
    const res = await context.app.request("/api/resources/not-a-uuid", { headers: { cookie: reader.cookie } });
    expect(res.status).toBe(404);
  });

  it("reads a Skill by its exact name, not through search", async () => {
    const published = await publish(context, writer, "by-name-skill", {
      description: "Reachable by exact name.",
      body: "# By name\n",
    });
    const { skill: publishedSkill } = (await published.json()) as ApiPublished;

    const res = await context.app.request("/api/resources/skill/by-name/by-name-skill", {
      headers: { cookie: reader.cookie },
    });
    expect(res.status).toBe(200);

    const skill = (await res.json()) as ApiSkill;
    expect(skill.id).toBe(publishedSkill.id);
    expect(skill.name).toBe("by-name-skill");
    expect(skill.body).toBe("# By name\n");
  });

  it("finds a Skill by name even when its name is an English stopword — a case full-text search cannot match", async () => {
    await publish(context, writer, "in", { description: "A one-word, stopword-only name.", body: "Body.\n" });

    const res = await context.app.request("/api/resources/skill/by-name/in", { headers: { cookie: reader.cookie } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ApiSkill).name).toBe("in");
  });

  it("returns 404 for a name that does not exist, and serves reads without a session", async () => {
    const missing = await context.app.request("/api/resources/skill/by-name/no-such-skill", {
      headers: { cookie: reader.cookie },
    });
    expect(missing.status).toBe(404);

    await publish(context, writer, "by-name-anonymous-attempt", {
      description: "Read without a session.",
      body: "Body.\n",
    });
    // The path `skillset add` takes with no Token configured (ADR-0013).
    const anonymous = await context.app.request("/api/resources/skill/by-name/by-name-anonymous-attempt");
    expect(anonymous.status).toBe(200);
    expect(((await anonymous.json()) as ApiSkill).name).toBe("by-name-anonymous-attempt");
  });

  it("keeps attribution after the publishing User is removed", async () => {
    const departing = await createUserAndLogIn(context, {
      first_name: "Katherine",
      last_name: "Johnson",
      email: "katherine@example.com",
      password: PASSWORD,
      role: "writer",
    });
    const published = await publish(context, departing, "orphaned-skill", {
      description: "Published by someone since removed.",
      body: "Body.\n",
    });
    const { skill: publishedSkill } = (await published.json()) as ApiPublished;

    await context.db.delete(users).where(eq(users.id, departing.id));

    const res = await context.app.request(`/api/resources/${publishedSkill.id}`, {
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

    // 51 Skills, one default page and one over, all with equal (zero)
    // installs — every ordering assertion below pins sort_by=updated_at
    // explicitly instead of relying on the installs-first default, so ties
    // don't make the test's own expectations flaky.
    const base = Date.UTC(2026, 0, 1);
    await context.db.insert(resources).values(
      Array.from({ length: 51 }, (_, index) => ({
        kind: "skill",
        name: `skill-${String(index).padStart(3, "0")}`,
        description: `Skill number ${index}.`,
        body: "Body.\n",
        payload: BLANK_SKILL_PAYLOAD,
        published_by: null,
        published_by_email: "ada@example.com",
        published_by_name: "Ada Lovelace",
        published_at: new Date(base + index * 60_000),
        updated_at: new Date(base + index * 60_000),
      })),
    );
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  it("defaults to page_size 10, sorted by installs descending", async () => {
    const res = await context.app.request("/api/resources", { headers: { cookie: reader.cookie } });
    expect(res.status).toBe(200);

    const page = (await res.json()) as ApiPage;
    expect(page.page).toBe(1);
    expect(page.page_size).toBe(10);
    expect(page.total).toBe(51);
    expect(page.items.length).toBe(10);
  });

  it("sorts by updated_at, most recent first by default order within that sort", async () => {
    const res = await context.app.request("/api/resources?sort_by=updated_at&page_size=100", {
      headers: { cookie: reader.cookie },
    });
    const page = (await res.json()) as ApiPage;
    expect(page.items[0]?.name).toBe("skill-050");
    expect(page.items[50]?.name).toBe("skill-000");
  });

  it("sorts ascending when sort_order=asc", async () => {
    const res = await context.app.request("/api/resources?sort_by=updated_at&sort_order=asc&page_size=100", {
      headers: { cookie: reader.cookie },
    });
    const page = (await res.json()) as ApiPage;
    expect(page.items[0]?.name).toBe("skill-000");
    expect(page.items[50]?.name).toBe("skill-050");
  });

  it("serves the rest on the next page", async () => {
    const res = await context.app.request("/api/resources?sort_by=updated_at&page=6", {
      headers: { cookie: reader.cookie },
    });
    const page = (await res.json()) as ApiPage;
    expect(page.page).toBe(6);
    expect(page.items.length).toBe(1);
    expect(page.items[0]?.name).toBe("skill-000");
  });

  it("treats a page beyond the end as empty rather than an error", async () => {
    const res = await context.app.request("/api/resources?page=99", { headers: { cookie: reader.cookie } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ApiPage).items).toEqual([]);
  });

  it("accepts a client-supplied page_size and clamps it to [1, 100] rather than rejecting it", async () => {
    const tooSmall = await context.app.request("/api/resources?page_size=0", { headers: { cookie: reader.cookie } });
    expect(((await tooSmall.json()) as ApiPage).page_size).toBe(1);

    const tooLarge = await context.app.request("/api/resources?page_size=1000", { headers: { cookie: reader.cookie } });
    expect(((await tooLarge.json()) as ApiPage).page_size).toBe(100);

    const withinBounds = await context.app.request("/api/resources?page_size=25", { headers: { cookie: reader.cookie } });
    const page = (await withinBounds.json()) as ApiPage;
    expect(page.page_size).toBe(25);
    expect(page.items.length).toBe(25);
  });

  it("rejects an invalid sort_by or sort_order, naming the field that failed", async () => {
    const badSortBy = await context.app.request("/api/resources?sort_by=name", { headers: { cookie: reader.cookie } });
    expect(badSortBy.status).toBe(400);
    expect(((await badSortBy.json()) as ApiError).error.field).toBe("sort_by");

    const badSortOrder = await context.app.request("/api/resources?sort_order=up", { headers: { cookie: reader.cookie } });
    expect(badSortOrder.status).toBe(400);
    expect(((await badSortOrder.json()) as ApiError).error.field).toBe("sort_order");
  });

  it("lists without a session", async () => {
    // Zero-friction browsing is the point of ADR-0013; only writes stay gated.
    const res = await context.app.request("/api/resources");
    expect(res.status).toBe(200);
  });
});

describe("Reading the Skill directory's hero stats (GET /resources/stats)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;

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
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  it("counts Skills, distinct Publishers by their email snapshot, and total Installs", async () => {
    const [one] = await context.db
      .insert(resources)
      .values({
        kind: "skill",
        name: "stats-skill-one",
        description: "First.",
        body: "Body.\n",
        payload: BLANK_SKILL_PAYLOAD,
        published_by: null,
        published_by_email: "grace@example.com",
        published_by_name: "Grace Hopper",
      })
      .returning();
    const [two] = await context.db
      .insert(resources)
      .values({
        kind: "skill",
        name: "stats-skill-two",
        description: "Second, same Publisher as the first.",
        body: "Body.\n",
        payload: BLANK_SKILL_PAYLOAD,
        published_by: null,
        published_by_email: "grace@example.com",
        published_by_name: "Grace Hopper",
      })
      .returning();
    if (!one || !two) throw new Error("Insert did not return the created Skills.");

    await context.db
      .insert(resourceInstallEvents)
      .values([
        { resource_id: one.id, source: "web" },
        { resource_id: one.id, source: "cli" },
        { resource_id: two.id, source: "web" },
      ]);
    await refreshInstallCounts(context);

    const res = await context.app.request("/api/resources/stats");
    expect(res.status).toBe(200);
    const stats = (await res.json()) as { skills: number; publishers: number; installs: number };
    expect(stats.skills).toBe(2);
    expect(stats.publishers).toBe(1);
    expect(stats.installs).toBe(3);
  });

  it("is readable without a session, same as every other Skill read (ADR-0013)", async () => {
    const res = await context.app.request("/api/resources/stats");
    expect(res.status).toBe(200);
  });
});

/**
 * Seam 1 again: `tag_id` is repeatable and any-match, and rides the same
 * `/skills` route the unfiltered list and search do (ticket 23).
 */
describe("Filtering the Skill list by Tag (ticket 23)", () => {
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
      body: JSON.stringify({ first_name: "Ada", last_name: "Lovelace", email: "ada@example.com", password: PASSWORD }),
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

  async function tag(id: string, tags: string[]): Promise<void> {
    await context.app.request(`/api/resources/${id}/tags`, {
      method: "PUT",
      headers: { cookie: writer.cookie, "content-type": "application/json" },
      body: JSON.stringify({ tags }),
    });
  }

  async function listByTags(...tagIds: string[]): Promise<ApiPage> {
    const params = new URLSearchParams();
    for (const id of tagIds) params.append("tag_id", id);
    const res = await context.app.request(`/api/resources?${params.toString()}`, { headers: { cookie: reader.cookie } });
    expect(res.status).toBe(200);
    return (await res.json()) as ApiPage;
  }

  async function tagIdOf(skillId: string, name: string): Promise<string> {
    const res = await context.app.request(`/api/resources/${skillId}`, { headers: { cookie: reader.cookie } });
    const skill = (await res.json()) as ApiSkill & { tags: ApiTag[] };
    const found = skill.tags.find((t) => t.name === name);
    if (!found) throw new Error(`Expected Tag "${name}" on Skill ${skillId}.`);
    return found.id;
  }

  it("narrows to Skills carrying the given Tag", async () => {
    const python = await publish(context, writer, "python-linter", { description: "Lints Python.", body: "Body.\n" });
    const rust = await publish(context, writer, "rust-formatter", { description: "Formats Rust.", body: "Body.\n" });
    await publish(context, writer, "untagged-skill", { description: "No Tags.", body: "Body.\n" });
    const { skill: pythonSkill } = (await python.json()) as ApiPublished;
    const { skill: rustSkill } = (await rust.json()) as ApiPublished;

    await tag(pythonSkill.id, ["linter", "python"]);
    await tag(rustSkill.id, ["formatter", "rust"]);

    const pythonTagId = await tagIdOf(pythonSkill.id, "python");
    const filtered = await listByTags(pythonTagId);
    expect(filtered.items.map((item) => item.name)).toEqual(["python-linter"]);
  });

  it("matches a Skill carrying any one of several selected Tags, not all of them", async () => {
    const backend = await publish(context, writer, "backend-skill", { description: "Backend.", body: "Body.\n" });
    const frontend = await publish(context, writer, "frontend-skill", { description: "Frontend.", body: "Body.\n" });
    await publish(context, writer, "neither-skill", { description: "Neither.", body: "Body.\n" });
    const { skill: backendSkill } = (await backend.json()) as ApiPublished;
    const { skill: frontendSkill } = (await frontend.json()) as ApiPublished;

    await tag(backendSkill.id, ["backend"]);
    await tag(frontendSkill.id, ["frontend"]);

    const backendTagId = await tagIdOf(backendSkill.id, "backend");
    const frontendTagId = await tagIdOf(frontendSkill.id, "frontend");

    const page = await listByTags(backendTagId, frontendTagId);
    expect(page.items.map((item) => item.name).sort()).toEqual(["backend-skill", "frontend-skill"]);
  });

  it("returns every Skill when no tag_id is given", async () => {
    const page = await listByTags();
    expect(page.total).toBeGreaterThanOrEqual(5);
  });
});

/**
 * Seam 1 again: full-text search rides the same `/skills` route as the
 * unfiltered list, so what's under test is the `q` parameter's behaviour —
 * plain phrases, quoted phrases, exclusions, pagination, the empty-query
 * fallback, and the term's last word being prefix-matched for type-ahead
 * (docs/adr/0004-postgres-over-sqlite.md) — plus the limitation that remains
 * once a word is finished and prefix-matching moves on to the next one:
 * stemming still isn't substring matching, so an earlier, already-typed word
 * has to be whole to match.
 */
describe("Searching Skills (ticket 10)", () => {
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

    // 51 near-identical "widget" Skills prove search paginates the same way
    // the unfiltered list does; four distinct Skills carry the vocabulary the
    // other tests search for, so neither set interferes with the other. All
    // share one publisher except "solo-effort", searched for by publisher
    // name alone (ticket 23).
    const base = Date.UTC(2026, 1, 1);
    await context.db.insert(resources).values([
      ...Array.from({ length: 51 }, (_, index) => ({
        kind: "skill",
        name: `widget-${String(index).padStart(3, "0")}`,
        description: "A generic widget Skill for demoing pagination.",
        body: "Body.\n",
        payload: BLANK_SKILL_PAYLOAD,
        published_by: null,
        published_by_email: "ada@example.com",
        published_by_name: "Ada Lovelace",
        published_at: new Date(base + index * 60_000),
        updated_at: new Date(base + index * 60_000),
      })),
      {
        kind: "skill",
        name: "postgresql-migrations",
        description: "Runs schema migrations against a Postgresql database.",
        body: "Body.\n",
        payload: BLANK_SKILL_PAYLOAD,
        published_by: null,
        published_by_email: "ada@example.com",
        published_by_name: "Ada Lovelace",
        published_at: new Date(base + 51 * 60_000),
        updated_at: new Date(base + 51 * 60_000),
      },
      {
        kind: "skill",
        name: "code-review-bot",
        description: "Comments on pull requests during code review.",
        body: "Body.\n",
        payload: BLANK_SKILL_PAYLOAD,
        published_by: null,
        published_by_email: "ada@example.com",
        published_by_name: "Ada Lovelace",
        published_at: new Date(base + 52 * 60_000),
        updated_at: new Date(base + 52 * 60_000),
      },
      {
        kind: "skill",
        name: "quality-metrics-tracker",
        description: "Tracks code quality and review turnaround over time.",
        body: "Body.\n",
        payload: BLANK_SKILL_PAYLOAD,
        published_by: null,
        published_by_email: "ada@example.com",
        published_by_name: "Ada Lovelace",
        published_at: new Date(base + 53 * 60_000),
        updated_at: new Date(base + 53 * 60_000),
      },
      {
        kind: "skill",
        name: "changelog-writer",
        description: "Drafts a changelog entry from recent commits.",
        body: "Body.\n",
        payload: BLANK_SKILL_PAYLOAD,
        published_by: null,
        published_by_email: "ada@example.com",
        published_by_name: "Ada Lovelace",
        published_at: new Date(base + 54 * 60_000),
        updated_at: new Date(base + 54 * 60_000),
      },
      {
        kind: "skill",
        name: "async-await",
        description: "A minimal concurrency helper.",
        body: "Body.\n",
        payload: BLANK_SKILL_PAYLOAD,
        published_by: null,
        published_by_email: "ada@example.com",
        published_by_name: "Ada Lovelace",
        published_at: new Date(base + 55 * 60_000),
        updated_at: new Date(base + 55 * 60_000),
      },
      {
        kind: "skill",
        name: "async-await-helper",
        description: "Handles retries for workflows that need to pause on network calls.",
        body: "Body.\n",
        payload: BLANK_SKILL_PAYLOAD,
        published_by: null,
        published_by_email: "ada@example.com",
        published_by_name: "Ada Lovelace",
        published_at: new Date(base + 56 * 60_000),
        updated_at: new Date(base + 56 * 60_000),
      },
      {
        kind: "skill",
        name: "solo-effort",
        description: "Nothing in this description names its own author.",
        body: "Body.\n",
        payload: BLANK_SKILL_PAYLOAD,
        published_by: null,
        published_by_email: "priya@example.com",
        published_by_name: "Priya Nair",
        published_at: new Date(base + 57 * 60_000),
        updated_at: new Date(base + 57 * 60_000),
      },
    ]);
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  // Every seeded Skill has 0 installs — pinning sort_by=updated_at (instead
  // of the installs-first default) is what makes these order assertions
  // meaningful rather than an artifact of the tie-break.
  async function search(q: string, extraParams: Record<string, string> = {}): Promise<ApiPage> {
    const params = new URLSearchParams({ q, sort_by: "updated_at", sort_order: "desc", ...extraParams });
    const res = await context.app.request(`/api/resources?${params.toString()}`, {
      headers: { cookie: reader.cookie },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as ApiPage;
  }

  it("matches a plain phrase against name or description", async () => {
    const page = await search("changelog");
    expect(page.items.map((s) => s.name)).toEqual(["changelog-writer"]);
  });

  it("matches a still-partial last word, so results appear before it's fully typed", async () => {
    const page = await search("chang");
    expect(page.items.map((s) => s.name)).toEqual(["changelog-writer"]);
  });

  it("prefix-matches only the last word of a multi-word term, treating earlier ones as finished", async () => {
    // Both Skills carry "code" and a word starting with "revi": "code review"
    // itself, and "quality-metrics-tracker"'s description ("Tracks code
    // quality and review turnaround over time.").
    const page = await search("code revi");
    expect(page.items.map((s) => s.name)).toEqual(["quality-metrics-tracker", "code-review-bot"]);
  });

  it("matches a quoted phrase only where the words are adjacent", async () => {
    const page = await search('"code review"');
    expect(page.items.map((s) => s.name)).toEqual(["code-review-bot"]);
  });

  it("excludes results carrying a `-excluded` term", async () => {
    const page = await search("review -bot");
    expect(page.items.map((s) => s.name)).toEqual(["quality-metrics-tracker"]);
  });

  it("returns the ordinary most-recent-first list for an empty search", async () => {
    const page = await search("");
    expect(page.page).toBe(1);
    expect(page.total).toBe(58);
    expect(page.items.length).toBe(10);
    expect(page.items[0]?.name).toBe("solo-effort");
  });

  it("paginates search results the same way the unfiltered list is", async () => {
    const page1 = await search("widget", { page_size: "50" });
    expect(page1.page).toBe(1);
    expect(page1.page_size).toBe(50);
    expect(page1.total).toBe(51);
    expect(page1.items.length).toBe(50);
    expect(page1.items[0]?.name).toBe("widget-050");

    const page2 = await search("widget", { page_size: "50", page: "2" });
    expect(page2.page).toBe(2);
    expect(page2.items.length).toBe(1);
    expect(page2.items[0]?.name).toBe("widget-000");
  });

  it("matches a search term against only a Skill's publisher (ticket 23)", async () => {
    const page = await search("priya");
    expect(page.items.map((s) => s.name)).toEqual(["solo-effort"]);
    expect(page.items[0]?.published_by_name).toBe("Priya Nair");
  });

  it("prefix-matches the term's last word, so a partial word finds it before it's fully typed", async () => {
    // "postgres" is a prefix of "postgresql", not a whole word by itself —
    // exact stemming alone would miss it, but the last token is
    // prefix-matched, so it's found while still mid-word.
    const page = await search("postgres");
    expect(page.items.map((s) => s.name)).toEqual(["postgresql-migrations"]);
  });

  it("prefix-matching the last word also broadens an already-whole word to what it's a prefix of", async () => {
    // "async-await" decomposes into "async" and "await", each prefix-matched
    // — so it now also finds "async-await-helper", which contains both as a
    // prefix, alongside the exact "async-await" it used to match alone.
    const page = await search("async-await");
    expect(page.items.map((s) => s.name)).toEqual(["async-await-helper", "async-await"]);
  });

  it("reads a Skill by id without going through search", async () => {
    const [row] = await context.db.select({ id: resources.id }).from(resources).where(eq(resources.name, "postgresql-migrations"));
    if (!row) throw new Error("Seed Skill was not inserted.");

    const res = await context.app.request(`/api/resources/${row.id}`, { headers: { cookie: reader.cookie } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ApiSkill).name).toBe("postgresql-migrations");
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

  it("serves a zip it assembles from the Artifact's stored files, named after the Skill", async () => {
    const published = await publish(context, writer, "downloadable-skill", {
      description: "Has an Artifact.",
      body: "Body.\n",
      files: [
        { path: "SKILL.md", size: 6 },
        { path: "references/style.md", size: 5 },
      ],
    });
    const { skill: publishedSkill } = (await published.json()) as ApiPublished;
    await putArtifact(context, publishedSkill.id, { "SKILL.md": "Body.\n", "references/style.md": "Style" });

    const res = await context.app.request(`/api/resources/${publishedSkill.id}/artifact`, {
      headers: { cookie: reader.cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    // The storage prefix is the id, not the Skill's name — without a
    // Content-Disposition naming the download, a browser's save dialog would
    // default to `<uuid>.zip`.
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="downloadable-skill.zip"');

    // The whole point of the new storage model is that the zip is derived,
    // not stored — so what matters is that it round-trips every file. Read
    // back through the shared extractor rather than a raw unzip, which also
    // asserts the archive is one `skillset add` accepts.
    const files = extractSkillFiles(new Uint8Array(await res.arrayBuffer()));
    expect(files.map((file) => file.path).sort()).toEqual(["SKILL.md", "references/style.md"]);
    const style = files.find((file) => file.path === "references/style.md");
    expect(new TextDecoder().decode(style?.bytes)).toBe("Style");
  });

  it("records exactly one Install per download", async () => {
    const published = await publish(context, writer, "counted-skill", {
      description: "Has an Artifact.",
      body: "Body.\n",
    });
    const { skill: publishedSkill } = (await published.json()) as ApiPublished;
    await putArtifact(context, publishedSkill.id, { "SKILL.md": "Body.\n" });

    for (let i = 0; i < 2; i++) {
      const res = await context.app.request(`/api/resources/${publishedSkill.id}/artifact`, {
        headers: { cookie: reader.cookie },
      });
      expect(res.status).toBe(200);
    }

    const events = await context.db
      .select()
      .from(resourceInstallEvents)
      .where(eq(resourceInstallEvents.resource_id, publishedSkill.id));
    expect(events.length).toBe(2);
  });

  it("records the Install's source from `?source=`, defaulting to 'web' when absent or unrecognised (ticket 48)", async () => {
    const published = await publish(context, writer, "sourced-skill", {
      description: "Has an Artifact.",
      body: "Body.\n",
    });
    const { skill: publishedSkill } = (await published.json()) as ApiPublished;
    await putArtifact(context, publishedSkill.id, { "SKILL.md": "Body.\n" });

    const cases: { query: string; expected: "web" | "cli" | "mcp" }[] = [
      { query: "", expected: "web" },
      { query: "?source=web", expected: "web" },
      { query: "?source=cli", expected: "cli" },
      { query: "?source=mcp", expected: "mcp" },
      { query: "?source=carrier-pigeon", expected: "web" },
    ];

    for (const { query } of cases) {
      const res = await context.app.request(`/api/resources/${publishedSkill.id}/artifact${query}`, {
        headers: { cookie: reader.cookie },
      });
      expect(res.status).toBe(200);
    }

    const events = await context.db
      .select()
      .from(resourceInstallEvents)
      .where(eq(resourceInstallEvents.resource_id, publishedSkill.id))
      // uuidv7 ids sort in insertion order, unlike `created_at`, which can
      // tie at this resolution for requests issued back-to-back.
      .orderBy(asc(resourceInstallEvents.id));
    expect(events.map((event) => event.source)).toEqual(cases.map((c) => c.expected));
  });

  it("serves an unauthenticated request", async () => {
    const published = await publish(context, writer, "another-downloadable-skill", {
      description: "Has an Artifact too.",
      body: "Body.\n",
    });
    const { skill: publishedSkill } = (await published.json()) as ApiPublished;
    await putArtifact(context, publishedSkill.id, { "SKILL.md": "Body.\n" });

    // What `skillset add` does against a Registry the User never logged in to (ADR-0013).
    const res = await context.app.request(`/api/resources/${publishedSkill.id}/artifact`);
    expect(res.status).toBe(200);
  });

  it("returns 404 for a Skill that does not exist", async () => {
    const res = await context.app.request(`/api/resources/${crypto.randomUUID()}/artifact`, {
      headers: { cookie: reader.cookie },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("not_found");
  });

  it("fails comprehensibly when the Skill's row exists but its Artifact was never uploaded", async () => {
    const published = await publish(context, writer, "abandoned-skill", {
      description: "The upload after this never happened.",
      body: "Body.\n",
    });
    const { skill: publishedSkill } = (await published.json()) as ApiPublished;

    const res = await context.app.request(`/api/resources/${publishedSkill.id}/artifact`, {
      headers: { cookie: reader.cookie },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("artifact_missing");
  });
});

/**
 * Seam 1 — browsing an Artifact file by file, which is what the interface's
 * preview is built on (ADR-0032). The listing is read back from storage
 * rather than from the manifest a publisher declared, so these seed storage
 * directly the way a presigned upload would.
 */
describe("Browsing an Artifact's files (ADR-0032)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;
  let writer: Session;

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
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  async function publishWithFiles(name: string, files: Record<string, string>): Promise<string> {
    const res = await publish(context, writer, name, {
      description: "Has an Artifact.",
      body: "Body.\n",
      files: Object.entries(files).map(([path, contents]) => ({ path, size: contents.length })),
    });
    if (res.status !== 200) throw new Error(`Publishing ${name} failed: ${res.status} ${await res.text()}`);
    const { skill } = (await res.json()) as ApiPublished;
    await putArtifact(context, skill.id, files);
    return skill.id;
  }

  it("lists every stored file with its size, SKILL.md first, unauthenticated", async () => {
    const id = await publishWithFiles("listable-skill", {
      "SKILL.md": "Body.\n",
      "references/style.md": "Style",
      "scripts/run.sh": "echo hi",
    });

    const res = await context.app.request(`/api/resources/${id}/files`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as ApiManifest;
    expect(body.files).toEqual([
      { path: "SKILL.md", size: 6 },
      { path: "references/style.md", size: 5 },
      { path: "scripts/run.sh", size: 7 },
    ]);
  });

  it("lists what storage holds, not what the manifest claimed", async () => {
    // A publish whose upload only partly finished: the row and the declared
    // manifest name two files, storage holds one. The listing is the honest
    // one (ADR-0032).
    const res = await publish(context, writer, "half-uploaded-skill", {
      description: "Has an Artifact.",
      body: "Body.\n",
      files: [
        { path: "SKILL.md", size: 6 },
        { path: "references/style.md", size: 5 },
      ],
    });
    const { skill } = (await res.json()) as ApiPublished;
    await putArtifact(context, skill.id, { "SKILL.md": "Body.\n" });

    const listed = await context.app.request(`/api/resources/${skill.id}/files`);
    const body = (await listed.json()) as ApiManifest;
    expect(body.files.map((file) => file.path)).toEqual(["SKILL.md"]);
  });

  it("404s the listing for a Skill whose Artifact was never uploaded", async () => {
    const res = await publish(context, writer, "unlisted-skill", { description: "No bytes.", body: "Body.\n" });
    const { skill } = (await res.json()) as ApiPublished;

    const listed = await context.app.request(`/api/resources/${skill.id}/files`);
    expect(listed.status).toBe(404);
    expect(((await listed.json()) as ApiError).error.code).toBe("artifact_missing");
  });

  it("serves one file's bytes with a content type read off its path", async () => {
    const id = await publishWithFiles("readable-skill", {
      "SKILL.md": "Body.\n",
      "references/style.md": "# Style\n",
      "scripts/run.sh": "echo hi",
    });

    const markdown = await context.app.request(`/api/resources/${id}/files/references/style.md`);
    expect(markdown.status).toBe(200);
    expect(markdown.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(markdown.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await markdown.text()).toBe("# Style\n");

    // The nested path is one file, not two path segments — the route has to
    // let the parameter swallow the slash.
    const script = await context.app.request(`/api/resources/${id}/files/scripts/run.sh`);
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toBe("text/x-shellscript; charset=utf-8");
  });

  it("404s a path the Artifact does not hold", async () => {
    const id = await publishWithFiles("sparse-skill", { "SKILL.md": "Body.\n" });

    const res = await context.app.request(`/api/resources/${id}/files/references/missing.md`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as ApiError).error.code).toBe("not_found");
  });

  it("refuses a path that would read outside the Resource's own prefix", async () => {
    const id = await publishWithFiles("guarded-skill", { "SKILL.md": "Body.\n" });

    // Sent pre-encoded so the traversal survives the router and reaches the
    // service's own check rather than being normalised away in transit.
    const res = await context.app.request(`/api/resources/${id}/files/..%2F..%2Fresources`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiError).error.code).toBe("entry_path_traversal");
  });

  it("republishing drops the files the new manifest no longer names", async () => {
    const id = await publishWithFiles("shrinking-skill", {
      "SKILL.md": "Body.\n",
      "references/gone.md": "Bye",
    });

    const republished = await publish(context, writer, "shrinking-skill", {
      description: "Fewer files now.",
      body: "Body.\n",
      files: [{ path: "SKILL.md", size: 6 }],
    });
    expect(republished.status).toBe(200);

    // Deleted when the upload URLs were issued, not after the upload — a
    // republish that drops a file must not leave it servable in between.
    const listed = await context.app.request(`/api/resources/${id}/files`);
    const body = (await listed.json()) as ApiManifest;
    expect(body.files.map((file) => file.path)).toEqual(["SKILL.md"]);
    expect(await context.storage.exists(`resources/${id}/references/gone.md`)).toBe(false);
  });

  const badManifests: Array<{ name: string; label: string; files: unknown; code: string }> = [
    { name: "rejected-not-a-list", label: "not a list", files: { "SKILL.md": 6 }, code: "manifest_invalid" },
    { name: "rejected-no-size", label: "an entry with no size", files: [{ path: "SKILL.md" }], code: "manifest_invalid" },
    { name: "rejected-no-skill-md", label: "no SKILL.md", files: [{ path: "readme.md", size: 4 }], code: "skill_md_missing" },
    {
      name: "rejected-traversal",
      label: "a parent-directory segment",
      files: [
        { path: "SKILL.md", size: 6 },
        { path: "../escape.md", size: 4 },
      ],
      code: "entry_path_traversal",
    },
    {
      name: "rejected-absolute",
      label: "an absolute path",
      files: [
        { path: "SKILL.md", size: 6 },
        { path: "/etc/passwd", size: 4 },
      ],
      code: "entry_absolute_path",
    },
    {
      name: "rejected-duplicate",
      label: "the same path twice",
      files: [
        { path: "SKILL.md", size: 6 },
        { path: "SKILL.md", size: 7 },
      ],
      code: "entry_duplicate",
    },
  ];

  for (const { name, label, files, code } of badManifests) {
    it(`refuses a manifest with ${label}, without writing a row`, async () => {
      const res = await context.app.request(`/api/resources/skill/${name}`, {
        method: "PUT",
        headers: { cookie: writer.cookie, "content-type": "application/json" },
        body: JSON.stringify({ description: "A Skill.", body: "Body.\n", files }),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as ApiError).error.code).toBe(code);

      // A failing manifest rejects the publish exactly like a failing
      // required field does (ADR-0009) — nothing about the Skill changes.
      const rows = await context.db.select().from(resources).where(eq(resources.name, name));
      expect(rows.length).toBe(0);
    });
  }

  it("reads a file without recording an Install", async () => {
    const id = await publishWithFiles("previewed-skill", { "SKILL.md": "Body.\n" });

    await context.app.request(`/api/resources/${id}/files`);
    await context.app.request(`/api/resources/${id}/files/SKILL.md`);

    // Previewing is not obtaining (ADR-0028) — only the zip download counts.
    const events = await context.db
      .select()
      .from(resourceInstallEvents)
      .where(eq(resourceInstallEvents.resource_id, id));
    expect(events.length).toBe(0);
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
    const published = await publish(context, writer, "doomed-skill", {
      description: "About to go.",
      body: "Body.\n",
    });
    const { skill: publishedSkill } = (await published.json()) as ApiPublished;
    await putArtifact(context, publishedSkill.id, { "SKILL.md": "Body.\n", "references/style.md": "Style" });

    const res = await context.app.request(`/api/resources/${publishedSkill.id}`, {
      method: "DELETE",
      headers: { cookie: admin.cookie },
    });
    expect(res.status).toBe(204);

    const rows = await context.db.select().from(resources).where(eq(resources.name, "doomed-skill"));
    expect(rows.length).toBe(0);
    // Every file, not just the one at the root — an Artifact is a prefix now
    // (ADR-0032).
    expect(await context.storage.list(`resources/${publishedSkill.id}/`)).toEqual([]);

    const missing = await context.app.request(`/api/resources/${publishedSkill.id}`, { headers: { cookie: reader.cookie } });
    expect(missing.status).toBe(404);

    const republished = await publish(context, writer, "doomed-skill", {
      description: "Back again.",
      body: "New body.\n",
    });
    expect(republished.status).toBe(200);
    // No version history: the name is free, but the row — and its id — is new.
    const { skill: republishedSkill } = (await republished.json()) as ApiPublished;
    expect(republishedSkill.id).not.toBe(publishedSkill.id);
  });

  it("succeeds even when the Artifact behind the row was never uploaded", async () => {
    const published = await publish(context, writer, "never-uploaded-skill", {
      description: "The upload never happened.",
      body: "Body.\n",
    });
    const { skill: publishedSkill } = (await published.json()) as ApiPublished;

    const res = await context.app.request(`/api/resources/${publishedSkill.id}`, {
      method: "DELETE",
      headers: { cookie: admin.cookie },
    });
    expect(res.status).toBe(204);

    const rows = await context.db.select().from(resources).where(eq(resources.name, "never-uploaded-skill"));
    expect(rows.length).toBe(0);
  });

  it("refuses readers and writers, allowing only Admins", async () => {
    const published = await publish(context, writer, "protected-skill", {
      description: "Not going anywhere yet.",
      body: "Body.\n",
    });
    const { skill: publishedSkill } = (await published.json()) as ApiPublished;

    const byReader = await context.app.request(`/api/resources/${publishedSkill.id}`, {
      method: "DELETE",
      headers: { cookie: reader.cookie },
    });
    expect(byReader.status).toBe(403);

    const byWriter = await context.app.request(`/api/resources/${publishedSkill.id}`, {
      method: "DELETE",
      headers: { cookie: writer.cookie },
    });
    expect(byWriter.status).toBe(403);

    const anonymous = await context.app.request(`/api/resources/${publishedSkill.id}`, { method: "DELETE" });
    expect(anonymous.status).toBe(401);

    const rows = await context.db.select().from(resources).where(eq(resources.name, "protected-skill"));
    expect(rows.length).toBe(1);
  });

  it("returns 404 for a Skill that does not exist", async () => {
    const res = await context.app.request(`/api/resources/${crypto.randomUUID()}`, {
      method: "DELETE",
      headers: { cookie: admin.cookie },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("not_found");
  });
});
