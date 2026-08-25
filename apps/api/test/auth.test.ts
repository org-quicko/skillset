import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { decode } from "hono/jwt";
import { SESSION_COOKIE_NAME } from "../src/auth/session.js";
import { users } from "../src/db/schema.js";
import { startTestContext, stopTestContext, type TestContext } from "./setup.js";

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
    const [row] = await context.db.select().from(users).where(eq(users.email, "ada@example.com")).limit(1);
    expect(row?.password_hash).toStartWith("$argon2id$");
    expect(row?.password_hash).not.toBe("correct-horse-battery");
  });

  it("carries only the User's id in the session — never the role", async () => {
    const token = superadminCookie.split("=")[1]!;
    const { payload } = decode(token);
    expect(Object.keys(payload).sort()).toEqual(["exp", "sub"]);
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
    const res = await context.app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "correct-horse-battery" }),
    });
    expect(res.status).toBe(200);
    superadminCookie = setCookieValue(res, SESSION_COOKIE_NAME);
  });

  it("refuses a wrong password and an unknown email identically, both padded to the same floor", async () => {
    const wrongPasswordStart = Date.now();
    const wrongPassword = await context.app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "totally-wrong-password" }),
    });
    const wrongPasswordElapsed = Date.now() - wrongPasswordStart;

    const unknownEmailStart = Date.now();
    const unknownEmail = await context.app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "totally-wrong-password" }),
    });
    const unknownEmailElapsed = Date.now() - unknownEmailStart;

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json());
    // Both must be padded up to the same floor, so a fast (no hash to verify)
    // and a slow (real argon2id verify) path aren't distinguishable by timing.
    expect(wrongPasswordElapsed).toBeGreaterThanOrEqual(190);
    expect(unknownEmailElapsed).toBeGreaterThanOrEqual(190);
  }, 10_000);

  it("does not assume a User has a password (ADR-0007) — login fails cleanly, not with a crash", async () => {
    await context.db.insert(users).values({
      email: "sso-user@example.com",
      first_name: "Sso",
      last_name: "User",
      password_hash: null,
      role: "reader",
    });

    const res = await context.app.request("/api/auth/login", {
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

  it("ends the session on logout", async () => {
    const res = await context.app.request("/api/auth/logout", {
      method: "POST",
      headers: { cookie: superadminCookie },
    });
    expect(res.status).toBe(204);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("Max-Age=0");

    // The browser would now stop sending the cookie the server just cleared.
    const meRes = await context.app.request("/api/users/me");
    expect(meRes.status).toBe(401);
  });

  it("refuses to log out without a session", async () => {
    const res = await context.app.request("/api/auth/logout", { method: "POST" });
    expect(res.status).toBe(401);
  });
});
