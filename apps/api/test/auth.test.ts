import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import { CREDENTIAL_PROVIDER_ID } from "../src/auth/credential.js";
import { accounts, sessions, users } from "../src/db/schemas/index.js";
import { SIGN_IN_PATH, SIGN_OUT_PATH, startTestContext, stopTestContext, type TestContext, SESSION_COOKIE_NAME } from "./setup.js";

interface ApiError {
  error: { code: string; message: string; field?: string };
}

interface ApiUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  must_change_password: boolean;
  created_at: string;
}

function setCookieValue(res: Response, name: string): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error(`No Set-Cookie header on response (expected "${name}").`);
  const match = new RegExp(`${name}=([^;]*)`).exec(setCookie);
  if (!match) throw new Error(`Set-Cookie header missing "${name}": ${setCookie}`);
  return `${name}=${match[1]}`;
}

describe("Bootstrap, sessions, and identity (ticket 02)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;
  let superadminCookie: string;

  beforeAll(async () => {
    const started = await startTestContext();
    container = started.container;
    context = started.context;
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  it("reports setup as uninitialised before any User exists", async () => {
    const res = await context.app.request("/api/setup");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ initialized: false });
  });

  it("rejects a signup password shorter than 12 characters", async () => {
    const res = await context.app.request("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@example.com",
        password: "short",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(body.error.field).toBe("password");
  });

  it("signs up the first User as a Superadmin and starts a session", async () => {
    const res = await context.app.request("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        first_name: "Ada",
        last_name: "Lovelace",
        email: "Ada@Example.com",
        password: "correct-horse-battery",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ApiUser;
    expect(body.role).toBe("superadmin");
    expect(body.email).toBe("ada@example.com"); // normalised to lowercase
    expect(body).not.toHaveProperty("password_hash");

    superadminCookie = setCookieValue(res, SESSION_COOKIE_NAME);
  });

  it("stores the password hashed with argon2id, never in plaintext", async () => {
    const [user] = await context.db.select().from(users).where(eq(users.email, "ada@example.com")).limit(1);
    const [credential] = await context.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.user_id, user!.id), eq(accounts.provider_id, CREDENTIAL_PROVIDER_ID)))
      .limit(1);

    // The column moved from users to accounts (ADR-0016); the algorithm did
    // not, which is what keeps every pre-migration hash verifiable.
    expect(credential?.password).toStartWith("$argon2id$");
    expect(credential?.password).not.toBe("correct-horse-battery");
  });

  it("carries only the User's identity in the session — never the role", async () => {
    const [session] = await context.db.select().from(sessions).limit(1);

    // ADR-0005's rule survives the move from a JWT to a row: the session says
    // who you are and nothing about what you may do, so a demotion cannot be
    // outrun by holding an old credential.
    expect(session?.user_id).toBeString();
    expect(Object.keys(session ?? {})).not.toContain("role");
  });

  it("reports setup as initialised once a User exists", async () => {
    const res = await context.app.request("/api/setup");
    expect(await res.json()).toEqual({ initialized: true });
  });

  it("closes signup once a User exists — regardless of who is asking", async () => {
    const res = await context.app.request("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        first_name: "Grace",
        last_name: "Hopper",
        email: "grace@example.com",
        password: "another-strong-password",
      }),
    });
    expect(res.status).toBe(409);

    const [row] = await context.db.select().from(users).where(eq(users.email, "grace@example.com")).limit(1);
    expect(row).toBeUndefined();
  });

  it("reports identity, names, and role for the authenticated User", async () => {
    const res = await context.app.request("/api/users/me", {
      headers: { cookie: superadminCookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      email: "ada@example.com",
      first_name: "Ada",
      last_name: "Lovelace",
      role: "superadmin",
      must_change_password: false,
    });
  });

  it("refuses to identify a request with no session", async () => {
    const res = await context.app.request("/api/users/me");
    expect(res.status).toBe(401);
  });

  it("logs in with email and password and receives a fresh session cookie", async () => {
    const res = await context.app.request(SIGN_IN_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "correct-horse-battery" }),
    });
    expect(res.status).toBe(200);
    superadminCookie = setCookieValue(res, SESSION_COOKIE_NAME);
  });

  it("refuses a wrong password and an unknown email identically, both padded to the same floor", async () => {
    const wrongPasswordStart = Date.now();
    const wrongPassword = await context.app.request(SIGN_IN_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "totally-wrong-password" }),
    });
    const wrongPasswordElapsed = Date.now() - wrongPasswordStart;

    const unknownEmailStart = Date.now();
    const unknownEmail = await context.app.request(SIGN_IN_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "totally-wrong-password" }),
    });
    const unknownEmailElapsed = Date.now() - unknownEmailStart;

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json());

    // Neither path may be the obviously fast one. The mechanism changed with
    // ADR-0016 and is worth stating: instead of padding the response to a
    // fixed floor, Better Auth hashes the supplied password anyway when there
    // is no User or no credential to verify against. Because the configured
    // hash is argon2id, that decoy costs what a real verify costs — so the
    // ratio is asserted here rather than a magic millisecond count, which
    // would only be re-measuring argon2id's speed on the test machine.
    const ratio =
      Math.max(wrongPasswordElapsed, unknownEmailElapsed) /
      Math.max(1, Math.min(wrongPasswordElapsed, unknownEmailElapsed));
    expect(ratio).toBeLessThan(5);
  }, 10_000);

  it("does not assume a User has a password (ADR-0007) — login fails cleanly, not with a crash", async () => {
    // No credential row at all, which is what a User who only ever arrived
    // through an Identity Provider looks like (ADR-0007).
    await context.db.insert(users).values({
      email: "sso-user@example.com",
      first_name: "Sso",
      last_name: "User",
      role: "reader",
    });

    const res = await context.app.request(SIGN_IN_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "sso-user@example.com", password: "anything-at-all" }),
    });
    expect(res.status).toBe(401);
  });

  it("resolves the role from the database on every request, taking effect without re-login", async () => {
    let res = await context.app.request("/api/users/me", { headers: { cookie: superadminCookie } });
    expect(((await res.json()) as ApiUser).role).toBe("superadmin");

    await context.db.update(users).set({ role: "writer" }).where(eq(users.email, "ada@example.com"));

    res = await context.app.request("/api/users/me", { headers: { cookie: superadminCookie } });
    expect(((await res.json()) as ApiUser).role).toBe("writer");

    // Restore, so later tests keep seeing a Superadmin.
    await context.db.update(users).set({ role: "superadmin" }).where(eq(users.email, "ada@example.com"));
  });

  it("revokes the session on logout, not merely the cookie", async () => {
    const res = await context.app.request(SIGN_OUT_PATH, {
      method: "POST",
      headers: { cookie: superadminCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");

    // The part ADR-0005 could not do. Replaying the very same cookie now fails
    // because the row behind it is gone — a session no longer outlives its
    // logout until the token happens to expire.
    const replayed = await context.app.request("/api/users/me", {
      headers: { cookie: superadminCookie },
    });
    expect(replayed.status).toBe(401);
  });

  it("treats logging out without a session as already logged out", async () => {
    // Not an error: there is no session to revoke and nothing for the caller
    // to do differently, so this reports success rather than 401.
    const res = await context.app.request(SIGN_OUT_PATH, { method: "POST" });
    expect(res.status).toBe(200);
  });
});
