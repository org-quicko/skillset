import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Role as UserRole } from "@skillset/shared";
import { setPasswordCredential } from "../src/auth/credential.js";
import { hashPassword } from "../src/auth/password.js";
import { tokens, users } from "../src/db/schemas/index.js";
import { SIGN_IN_PATH, startTestContext, stopTestContext, type TestContext, SESSION_COOKIE_NAME } from "./setup.js";

interface ApiToken {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

interface ApiTokenCreated extends ApiToken {
  secret: string;
}

interface ApiUser {
  id: string;
  email: string;
  role: string;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("Response did not set a session cookie.");
  const match = new RegExp(`${SESSION_COOKIE_NAME}=([^;]*)`).exec(setCookie);
  if (!match) throw new Error(`Set-Cookie missing "${SESSION_COOKIE_NAME}": ${setCookie}`);
  return `${SESSION_COOKIE_NAME}=${match[1]}`;
}

/** The bootstrap route only ever creates the first User, and makes them the Superadmin. */
async function bootstrapAdmin(
  context: TestContext,
  body: { first_name: string; last_name: string; email: string; password: string },
): Promise<{ cookie: string; user: ApiUser }> {
  const res = await context.app.request("/api/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { cookie: sessionCookie(res), user: (await res.json()) as ApiUser };
}

/**
 * Seeded through the database rather than an API call: creating a second
 * User is an Admin action that lands in ticket 11, and these tests need
 * Users with non-Admin roles today. Logging in afterwards goes through the
 * real route, so the session under test is a genuine one.
 */
async function createUserAndLogIn(
  context: TestContext,
  body: { first_name: string; last_name: string; email: string; password: string; role: UserRole },
): Promise<{ cookie: string; user: ApiUser }> {
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
  return { cookie: sessionCookie(res), user: (await res.json()) as ApiUser };
}

/**
 * Seam 1 — the API request boundary (spec, "Testing Decisions"): no server
 * listens; `app.request(...)` calls the Hono app directly against a real
 * Postgres and a fake storage adapter.
 */
describe("Tokens (ticket 05)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;
  let adminCookie: string;
  let admin: ApiUser;

  beforeAll(async () => {
    const started = await startTestContext();
    container = started.container;
    context = started.context;

    const signedUp = await bootstrapAdmin(context, {
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      password: "correct-horse-battery",
    });
    adminCookie = signedUp.cookie;
    admin = signedUp.user;
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  it("mints a Token with a display name, returning the secret exactly once", async () => {
    const res = await context.app.request("/api/users/me/tokens", {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "my-laptop" }),
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as ApiTokenCreated;
    expect(body.name).toBe("my-laptop");
    expect(body.last_used_at).toBeNull();
    expect(typeof body.secret).toBe("string");

    const listRes = await context.app.request("/api/users/me/tokens", { headers: { cookie: adminCookie } });
    const list = (await listRes.json()) as ApiToken[];
    const listed = list.find((t) => t.id === body.id);
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty("secret");
    // The minted response is the only place the secret ever appears.
    expect(JSON.stringify(list)).not.toContain(body.secret);
  });

  it("generates a secret from a cryptographically secure source with at least 256 bits of entropy", async () => {
    const res = await context.app.request("/api/users/me/tokens", {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "entropy-check" }),
    });
    const { secret } = (await res.json()) as ApiTokenCreated;
    // base64url of 32 random bytes decodes back to exactly 32 bytes (256 bits).
    const decoded = Buffer.from(secret, "base64url");
    expect(decoded.length).toBeGreaterThanOrEqual(32);

    const otherRes = await context.app.request("/api/users/me/tokens", {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "entropy-check-2" }),
    });
    const { secret: otherSecret } = (await otherRes.json()) as ApiTokenCreated;
    expect(otherSecret).not.toBe(secret);
  });

  it("stores only a SHA-256 digest of the secret — never the secret itself", async () => {
    const res = await context.app.request("/api/users/me/tokens", {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "digest-check" }),
    });
    const created = (await res.json()) as ApiTokenCreated;

    const [row] = await context.db.select().from(tokens).where(eq(tokens.id, created.id)).limit(1);
    expect(row?.token_hash).toBe(sha256Hex(created.secret));
    expect(row?.token_hash).not.toBe(created.secret);
    expect(row?.token_hash).not.toStartWith("$argon2id$");
  });

  it("rejects minting with no name", async () => {
    const res = await context.app.request("/api/users/me/tokens", {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("refuses to mint without a session or Token", async () => {
    const res = await context.app.request("/api/users/me/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "no-auth" }),
    });
    expect(res.status).toBe(401);
  });

  it("authenticates a request bearing a valid Token as its owner, role resolved from the database", async () => {
    const mintRes = await context.app.request("/api/users/me/tokens", {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "cli-token" }),
    });
    const { secret } = (await mintRes.json()) as ApiTokenCreated;

    const meRes = await context.app.request("/api/users/me", {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(meRes.status).toBe(200);
    const me = (await meRes.json()) as ApiUser;
    expect(me.id).toBe(admin.id);
    expect(me.role).toBe("superadmin");
  });

  it("updates a Token's last-used time as it is used", async () => {
    const mintRes = await context.app.request("/api/users/me/tokens", {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "last-used-check" }),
    });
    const created = (await mintRes.json()) as ApiTokenCreated;
    expect(created.last_used_at).toBeNull();

    await context.app.request("/api/users/me", { headers: { authorization: `Bearer ${created.secret}` } });

    const listRes = await context.app.request("/api/users/me/tokens", { headers: { cookie: adminCookie } });
    const list = (await listRes.json()) as ApiToken[];
    const used = list.find((t) => t.id === created.id);
    expect(used?.last_used_at).not.toBeNull();
  });

  it("fails the very next request bearing a Token once it is revoked", async () => {
    const mintRes = await context.app.request("/api/users/me/tokens", {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "revoke-check" }),
    });
    const created = (await mintRes.json()) as ApiTokenCreated;

    const beforeRevoke = await context.app.request("/api/users/me", {
      headers: { authorization: `Bearer ${created.secret}` },
    });
    expect(beforeRevoke.status).toBe(200);

    const revokeRes = await context.app.request(`/api/users/me/tokens/${created.id}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(revokeRes.status).toBe(204);

    const afterRevoke = await context.app.request("/api/users/me", {
      headers: { authorization: `Bearer ${created.secret}` },
    });
    expect(afterRevoke.status).toBe(401);
  });

  it("refuses a Token that was never minted", async () => {
    const res = await context.app.request("/api/users/me", {
      headers: { authorization: "Bearer not-a-real-secret" },
    });
    expect(res.status).toBe(401);
  });

  it("grants a Token no more than its owner's current role — a demotion applies to existing Tokens immediately", async () => {
    const reader = await createUserAndLogIn(context, {
      first_name: "Grace",
      last_name: "Hopper",
      email: "grace@example.com",
      password: "another-strong-password",
      role: "reader",
    });

    const mintRes = await context.app.request("/api/users/me/tokens", {
      method: "POST",
      headers: { cookie: reader.cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "reader-token" }),
    });
    const created = (await mintRes.json()) as ApiTokenCreated;

    let meRes = await context.app.request("/api/users/me", { headers: { authorization: `Bearer ${created.secret}` } });
    expect(((await meRes.json()) as ApiUser).role).toBe("reader");

    await context.db.update(users).set({ role: "writer" }).where(eq(users.email, "grace@example.com"));

    meRes = await context.app.request("/api/users/me", { headers: { authorization: `Bearer ${created.secret}` } });
    expect(((await meRes.json()) as ApiUser).role).toBe("writer");
  });

  it("lists a User's own Tokens by display name, created-at, and last-used-at only", async () => {
    const res = await context.app.request("/api/users/me/tokens", { headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);
    const list = (await res.json()) as ApiToken[];
    expect(list.length).toBeGreaterThan(0);
    for (const token of list) {
      expect(Object.keys(token).sort()).toEqual(["created_at", "id", "last_used_at", "name"]);
    }
  });

  it("shows a User only their own Tokens, and refuses to revoke another User's Token", async () => {
    const writer = await createUserAndLogIn(context, {
      first_name: "Margaret",
      last_name: "Hamilton",
      email: "margaret@example.com",
      password: "yet-another-strong-password",
      role: "writer",
    });

    const adminMintRes = await context.app.request("/api/users/me/tokens", {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "admin-only-token" }),
    });
    const adminToken = (await adminMintRes.json()) as ApiTokenCreated;

    const writerListRes = await context.app.request("/api/users/me/tokens", { headers: { cookie: writer.cookie } });
    const writerList = (await writerListRes.json()) as ApiToken[];
    expect(writerList.some((t) => t.id === adminToken.id)).toBe(false);

    const deleteRes = await context.app.request(`/api/users/me/tokens/${adminToken.id}`, {
      method: "DELETE",
      headers: { cookie: writer.cookie },
    });
    expect(deleteRes.status).toBe(404);

    // The Admin's Token still works — the mismatched owner never touched it.
    const meRes = await context.app.request("/api/users/me", {
      headers: { authorization: `Bearer ${adminToken.secret}` },
    });
    expect(meRes.status).toBe(200);
  });

  it("returns 404 revoking a Token id that does not exist or is malformed", async () => {
    const missing = await context.app.request(`/api/users/me/tokens/${crypto.randomUUID()}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(missing.status).toBe(404);

    const malformed = await context.app.request("/api/users/me/tokens/not-a-uuid", {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(malformed.status).toBe(404);
  });

  it("refuses to list or revoke Tokens without a session or Token", async () => {
    const listRes = await context.app.request("/api/users/me/tokens");
    expect(listRes.status).toBe(401);

    const deleteRes = await context.app.request(`/api/users/me/tokens/${crypto.randomUUID()}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(401);
  });
});
