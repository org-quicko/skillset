import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Role } from "@skill-registry/shared";
import { setPasswordCredential } from "../src/auth/credential.js";
import { hashPassword } from "../src/auth/password.js";
import { users } from "../src/db/schemas/index.js";
import { SIGN_IN_PATH, startTestContext, stopTestContext, type TestContext, SESSION_COOKIE_NAME } from "./setup.js";

interface ApiTag {
  id: string;
  name: string;
}

interface ApiSkill {
  id: string;
  tags: ApiTag[];
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
  const match = new RegExp(`${SESSION_COOKIE_NAME}=([^;]*)`).exec(setCookie);
  if (!match) throw new Error(`Set-Cookie header missing "${SESSION_COOKIE_NAME}": ${setCookie}`);
  return `${SESSION_COOKIE_NAME}=${match[1]}`;
}

/** Same seeding approach as skills.test.ts — see its comment for why. */
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

async function publish(context: TestContext, session: Session, name: string): Promise<string> {
  const res = await context.app.request(`/api/skills/${name}`, {
    method: "PUT",
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ description: "A Skill.", body: "Body.\n" }),
  });
  const { skill } = (await res.json()) as { skill: { id: string } };
  return skill.id;
}

async function setTags(context: TestContext, session: Session, skillId: string, names: unknown): Promise<Response> {
  return context.app.request(`/api/skills/${skillId}/tags`, {
    method: "PUT",
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ tags: names }),
  });
}

async function getSkill(context: TestContext, session: Session, skillId: string): Promise<ApiSkill> {
  const res = await context.app.request(`/api/skills/${skillId}`, { headers: { cookie: session.cookie } });
  return (await res.json()) as ApiSkill;
}

const PASSWORD = "correct-horse-battery";

describe("Setting a Skill's tags (PUT /skills/{id}/tags)", () => {
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
      body: JSON.stringify({ first_name: "Ada", last_name: "Lovelace", email: "ada@example.com", password: PASSWORD }),
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

  it("resolves each name to a catalog Tag, normalising and creating any that don't exist yet", async () => {
    const skillId = await publish(context, writer, "tagged-skill");

    const res = await setTags(context, writer, skillId, ["AI", " Code-Review "]);
    expect(res.status).toBe(200);
    const { tags } = (await res.json()) as { tags: ApiTag[] };
    expect(tags.map((tag) => tag.name)).toEqual(["ai", "code-review"]);
    tags.forEach((tag) => expect(typeof tag.id).toBe("string"));

    const skill = await getSkill(context, reader, skillId);
    expect(skill.tags.map((tag) => tag.name)).toEqual(["ai", "code-review"]);
  });

  it("is a full replace — a second call drops whatever isn't in the new list", async () => {
    const skillId = await publish(context, writer, "replace-tags-skill");
    await setTags(context, writer, skillId, ["one", "two"]);

    const res = await setTags(context, writer, skillId, ["two", "three"]);
    expect(res.status).toBe(200);
    const { tags } = (await res.json()) as { tags: ApiTag[] };
    expect(tags.map((tag) => tag.name)).toEqual(["three", "two"]);
  });

  it("dedupes names that normalise to the same Tag", async () => {
    const skillId = await publish(context, writer, "dedupe-tags-skill");

    const res = await setTags(context, writer, skillId, ["AI", "ai", " ai "]);
    expect(res.status).toBe(200);
    const { tags } = (await res.json()) as { tags: ApiTag[] };
    expect(tags.map((tag) => tag.name)).toEqual(["ai"]);
  });

  it("reuses the same catalog Tag across Skills rather than creating a duplicate", async () => {
    const first = await publish(context, writer, "shared-tag-skill-one");
    const second = await publish(context, writer, "shared-tag-skill-two");

    const firstRes = await setTags(context, writer, first, ["shared"]);
    const secondRes = await setTags(context, writer, second, ["shared"]);
    const firstTags = ((await firstRes.json()) as { tags: ApiTag[] }).tags;
    const secondTags = ((await secondRes.json()) as { tags: ApiTag[] }).tags;

    expect(secondTags[0]?.id).toBe(firstTags[0]?.id);
  });

  it("leaves a detached Tag in the catalog rather than deleting it", async () => {
    const skillId = await publish(context, writer, "detach-tag-skill");
    await setTags(context, writer, skillId, ["orphan-candidate"]);
    await setTags(context, writer, skillId, []);

    const catalog = await context.app.request("/api/tags", { headers: { cookie: reader.cookie } });
    const { items } = (await catalog.json()) as { items: ApiTag[] };
    expect(items.map((tag) => tag.name)).toContain("orphan-candidate");

    const skill = await getSkill(context, reader, skillId);
    expect(skill.tags).toEqual([]);
  });

  it("refuses a reader, allows writers and Admins", async () => {
    const skillId = await publish(context, writer, "role-gated-tags-skill");

    const byReader = await setTags(context, reader, skillId, ["x"]);
    expect(byReader.status).toBe(403);

    const byWriter = await setTags(context, writer, skillId, ["x"]);
    expect(byWriter.status).toBe(200);

    const byAdmin = await setTags(context, admin, skillId, ["y"]);
    expect(byAdmin.status).toBe(200);
  });

  it("rejects an invalid tag name, naming the rule that failed, and leaves the Skill's tags unchanged", async () => {
    const skillId = await publish(context, writer, "invalid-tag-name-skill");
    await setTags(context, writer, skillId, ["kept"]);

    const res = await setTags(context, writer, skillId, ["kept", "not valid!"]);
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("name_invalid");
    expect(body.error.field).toBe("name");

    const skill = await getSkill(context, reader, skillId);
    expect(skill.tags.map((tag) => tag.name)).toEqual(["kept"]);
  });

  it("rejects a tags field that isn't an array", async () => {
    const skillId = await publish(context, writer, "non-array-tags-skill");

    const res = await setTags(context, writer, skillId, "not-an-array");
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("tags_invalid");
  });

  it("returns 404 for a Skill that does not exist", async () => {
    const res = await setTags(context, writer, crypto.randomUUID(), ["x"]);
    expect(res.status).toBe(404);
  });
});

describe("Listing the Tag catalog (GET /tags)", () => {
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
      body: JSON.stringify({ first_name: "Ada", last_name: "Lovelace", email: "ada@example.com", password: PASSWORD }),
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

  it("lists every Tag, alphabetically by name", async () => {
    const skillId = await publish(context, writer, "catalog-skill");
    await setTags(context, writer, skillId, ["zebra", "apple", "mango"]);

    const res = await context.app.request("/api/tags", { headers: { cookie: writer.cookie } });
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: ApiTag[] };
    expect(items.map((tag) => tag.name)).toEqual(["apple", "mango", "zebra"]);
  });

  it("refuses listing without a session", async () => {
    const res = await context.app.request("/api/tags");
    expect(res.status).toBe(401);
  });
});

describe("Renaming a Tag (PATCH /tags/{id})", () => {
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
      body: JSON.stringify({ first_name: "Ada", last_name: "Lovelace", email: "ada@example.com", password: PASSWORD }),
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

  async function rename(session: Session, tagId: string, name: unknown): Promise<Response> {
    return context.app.request(`/api/tags/${tagId}`, {
      method: "PATCH",
      headers: { cookie: session.cookie, "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }

  it("renames in place — every Skill referencing it picks up the new name automatically", async () => {
    const skillId = await publish(context, writer, "rename-propagates-skill");
    const setRes = await setTags(context, writer, skillId, ["old-name"]);
    const tagId = ((await setRes.json()) as { tags: ApiTag[] }).tags[0]?.id;
    if (!tagId) throw new Error("Tag was not created.");

    const res = await rename(admin, tagId, "new-name");
    expect(res.status).toBe(200);
    expect(((await res.json()) as ApiTag).name).toBe("new-name");

    const skill = await getSkill(context, reader, skillId);
    expect(skill.tags.map((tag) => tag.name)).toEqual(["new-name"]);
  });

  it("rejects a rename that collides with a different Tag's name", async () => {
    const skillId = await publish(context, writer, "conflict-tags-skill");
    const setRes = await setTags(context, writer, skillId, ["existing-name", "renaming-this-one"]);
    const created = ((await setRes.json()) as { tags: ApiTag[] }).tags;
    const target = created.find((tag) => tag.name === "renaming-this-one");
    if (!target) throw new Error("Tag was not created.");

    const res = await rename(admin, target.id, "existing-name");
    expect(res.status).toBe(409);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("tag_name_conflict");
    expect(body.error.field).toBe("name");
  });

  it("allows renaming a Tag to the name it already has", async () => {
    const skillId = await publish(context, writer, "self-rename-skill");
    const setRes = await setTags(context, writer, skillId, ["unchanged"]);
    const tagId = ((await setRes.json()) as { tags: ApiTag[] }).tags[0]?.id;
    if (!tagId) throw new Error("Tag was not created.");

    const res = await rename(admin, tagId, "unchanged");
    expect(res.status).toBe(200);
  });

  it("refuses a writer, allowing only Admins", async () => {
    const skillId = await publish(context, writer, "writer-cannot-rename-skill");
    const setRes = await setTags(context, writer, skillId, ["writer-cannot-touch"]);
    const tagId = ((await setRes.json()) as { tags: ApiTag[] }).tags[0]?.id;
    if (!tagId) throw new Error("Tag was not created.");

    const byWriter = await rename(writer, tagId, "attempted-rename");
    expect(byWriter.status).toBe(403);

    const byReader = await rename(reader, tagId, "attempted-rename");
    expect(byReader.status).toBe(403);

    const anonymous = await context.app.request(`/api/tags/${tagId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "attempted-rename" }),
    });
    expect(anonymous.status).toBe(401);
  });

  it("returns 404 for a Tag that does not exist", async () => {
    const res = await rename(admin, crypto.randomUUID(), "whatever");
    expect(res.status).toBe(404);
  });

  it("returns 404 for a malformed id", async () => {
    const res = await rename(admin, "not-a-uuid", "whatever");
    expect(res.status).toBe(404);
  });
});
