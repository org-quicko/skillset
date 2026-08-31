import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Role } from "@skill-registry/shared";
import { eq } from "drizzle-orm";
import { setPasswordCredential } from "../src/auth/credential.js";
import { hashPassword } from "../src/auth/password.js";
import { users } from "../src/db/schemas/index.js";
import { SIGN_IN_PATH, SIGN_OUT_PATH, startTestContext, stopTestContext, type TestContext, SESSION_COOKIE_NAME } from "./setup.js";

interface ApiUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  must_change_password: boolean;
  created_at: string;
}

interface ApiUserPage {
  items: ApiUser[];
  page: number;
  page_size: number;
  total: number;
}

interface ApiUserCreated {
  user: ApiUser;
  initial_password: string;
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

/**
 * Seeded through the database rather than an Admin's `POST /users`, so tests
 * that don't concern that route itself can still exercise a real session.
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

const PASSWORD = "correct-horse-battery";

/**
 * Seam 1 — the API request boundary (spec, "Testing Decisions"): no server
 * listens; `app.request(...)` calls the Hono app directly against a real
 * Postgres and a fake storage adapter.
 */
describe("Managing Users (ticket 11)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;
  let admin: Session;

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
      id: ((await signUp.json()) as ApiUser).id,
    };
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  it("lets an Admin create a User with a generated initial password, shown once", async () => {
    const res = await context.app.request("/api/users", {
      method: "POST",
      headers: { cookie: admin.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        first_name: "Grace",
        last_name: "Hopper",
        email: "grace@example.com",
        role: "writer",
      }),
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as ApiUserCreated;
    expect(body.user.email).toBe("grace@example.com");
    expect(body.user.role).toBe("writer");
    expect(body.user.must_change_password).toBe(true);
    expect(typeof body.initial_password).toBe("string");
    expect(body.initial_password.length).toBeGreaterThanOrEqual(12);
    expect(body.user).not.toHaveProperty("password_hash");
    expect(body.user).not.toHaveProperty("initial_password");
  });

  it("marks a created User's email verified, so a Provider can sign them in later", async () => {
    // Not cosmetic, and not really about verification: Better Auth refuses to
    // link a Provider login to a local row whose email is unverified, so a
    // User created here with this false could never sign in through Google —
    // it fails with `account_not_linked`. ADR-0015 requires that a login whose
    // verified email matches an existing User signs in as that User, whether
    // or not they have a password, and this flag is what allows it.
    const [row] = await context.db.select().from(users).where(eq(users.email, "grace@example.com")).limit(1);
    expect(row?.email_verified).toBe(true);
  });

  it("requires the new User to change their generated password before doing anything else", async () => {
    const login = await context.app.request(SIGN_IN_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "grace@example.com", password: "will-be-replaced" }),
    });
    expect(login.status).toBe(401); // wrong password — sanity check the fixture below picks the real one.

    // Mint a real credential for Grace via a fresh Admin-created User so we
    // know her actual initial password.
    const createRes = await context.app.request("/api/users", {
      method: "POST",
      headers: { cookie: admin.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        first_name: "Margaret",
        last_name: "Hamilton",
        email: "margaret@example.com",
        role: "reader",
      }),
    });
    const created = (await createRes.json()) as ApiUserCreated;

    const margaretLogin = await context.app.request(SIGN_IN_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "margaret@example.com", password: created.initial_password }),
    });
    expect(margaretLogin.status).toBe(200);
    const margaretCookie = sessionCookie(margaretLogin);

    // Blocked from everything but reading her own record.
    const blocked = await context.app.request("/api/users/me/tokens", { headers: { cookie: margaretCookie } });
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as ApiError).error.code).toBe("password_change_required");

    // Asserted here rather than on the sign-in response: that response is
    // Better Auth's envelope around its own session user (ADR-0016), and
    // `/users/me` is the Registry's User — the shape the interface actually
    // reads, and the only one carrying the role.
    const readSelf = await context.app.request("/api/users/me", { headers: { cookie: margaretCookie } });
    expect(readSelf.status).toBe(200);
    expect(((await readSelf.json()) as ApiUser).must_change_password).toBe(true);

    // Replacing it clears the requirement.
    const replace = await context.app.request("/api/users/me/password", {
      method: "PUT",
      headers: { cookie: margaretCookie, "content-type": "application/json" },
      body: JSON.stringify({ current_password: created.initial_password, new_password: "a-brand-new-password" }),
    });
    expect(replace.status).toBe(204);

    const afterReplace = await context.app.request("/api/users/me/tokens", { headers: { cookie: margaretCookie } });
    expect(afterReplace.status).toBe(200);

    const me = await context.app.request("/api/users/me", { headers: { cookie: margaretCookie } });
    expect(((await me.json()) as ApiUser).must_change_password).toBe(false);
  });

  it("lets a User log out even while a generated password is still pending replacement", async () => {
    const createRes = await context.app.request("/api/users", {
      method: "POST",
      headers: { cookie: admin.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        first_name: "Bessica",
        last_name: "Raiche",
        email: "bessica@example.com",
        role: "reader",
      }),
    });
    const created = (await createRes.json()) as ApiUserCreated;

    const login = await context.app.request(SIGN_IN_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "bessica@example.com", password: created.initial_password }),
    });
    const cookie = sessionCookie(login);

    // Signing out is never gated on the pending password change: the gate
    // stops a User doing anything else with the session, not giving it up.
    // Without that, someone who mistyped a generated password would be stuck
    // with the session until it expired on its own.
    const logout = await context.app.request(SIGN_OUT_PATH, { method: "POST", headers: { cookie } });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("lets any User change their own password without an Admin", async () => {
    const writer = await createUserAndLogIn(context, {
      first_name: "Katherine",
      last_name: "Johnson",
      email: "katherine@example.com",
      password: PASSWORD,
      role: "writer",
    });

    const res = await context.app.request("/api/users/me/password", {
      method: "PUT",
      headers: { cookie: writer.cookie, "content-type": "application/json" },
      body: JSON.stringify({ current_password: PASSWORD, new_password: "another-brand-new-password" }),
    });
    expect(res.status).toBe(204);

    const reLogin = await context.app.request(SIGN_IN_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "katherine@example.com", password: "another-brand-new-password" }),
    });
    expect(reLogin.status).toBe(200);
  });

  it("refuses to replace a password with the wrong current password", async () => {
    const reader = await createUserAndLogIn(context, {
      first_name: "Dorothy",
      last_name: "Vaughan",
      email: "dorothy@example.com",
      password: PASSWORD,
      role: "reader",
    });

    const res = await context.app.request("/api/users/me/password", {
      method: "PUT",
      headers: { cookie: reader.cookie, "content-type": "application/json" },
      body: JSON.stringify({ current_password: "not-the-right-one", new_password: "yet-another-new-password" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiError).error.field).toBe("current_password");
  });

  it("lets any User correct their own first and last name", async () => {
    const reader = await createUserAndLogIn(context, {
      first_name: "Mae",
      last_name: "Jemison",
      email: "mae@example.com",
      password: PASSWORD,
      role: "reader",
    });

    const res = await context.app.request("/api/users/me", {
      method: "PATCH",
      headers: { cookie: reader.cookie, "content-type": "application/json" },
      body: JSON.stringify({ last_name: "Jemison-Carter" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiUser;
    expect(body.first_name).toBe("Mae");
    expect(body.last_name).toBe("Jemison-Carter");
  });

  it("refuses PATCH /users/me with neither name field", async () => {
    const res = await context.app.request("/api/users/me", {
      method: "PATCH",
      headers: { cookie: admin.cookie, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("lets an Admin change another User's role, taking effect on that User's next request", async () => {
    const reader = await createUserAndLogIn(context, {
      first_name: "Sally",
      last_name: "Ride",
      email: "sally@example.com",
      password: PASSWORD,
      role: "reader",
    });

    const before = await context.app.request("/api/users/me", { headers: { cookie: reader.cookie } });
    expect(((await before.json()) as ApiUser).role).toBe("reader");

    const patch = await context.app.request(`/api/users/${reader.id}`, {
      method: "PATCH",
      headers: { cookie: admin.cookie, "content-type": "application/json" },
      body: JSON.stringify({ role: "writer" }),
    });
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as ApiUser).role).toBe("writer");

    const after = await context.app.request("/api/users/me", { headers: { cookie: reader.cookie } });
    expect(((await after.json()) as ApiUser).role).toBe("writer");
  });

  it("refuses to let an Admin change their own role or remove their own account through this route", async () => {
    const otherAdmin = await createUserAndLogIn(context, {
      first_name: "Bessie",
      last_name: "Coleman",
      email: "bessie@example.com",
      password: PASSWORD,
      role: "admin",
    });

    const patch = await context.app.request(`/api/users/${otherAdmin.id}`, {
      method: "PATCH",
      headers: { cookie: otherAdmin.cookie, "content-type": "application/json" },
      body: JSON.stringify({ role: "reader" }),
    });
    expect(patch.status).toBe(400);

    const del = await context.app.request(`/api/users/${otherAdmin.id}`, {
      method: "DELETE",
      headers: { cookie: otherAdmin.cookie },
    });
    expect(del.status).toBe(400);

    const [row] = await context.db.select().from(users).where(eq(users.id, otherAdmin.id)).limit(1);
    expect(row?.role).toBe("admin");
  });

  it("lets an Admin remove a User, ending their access", async () => {
    const target = await createUserAndLogIn(context, {
      first_name: "Valentina",
      last_name: "Tereshkova",
      email: "valentina@example.com",
      password: PASSWORD,
      role: "reader",
    });

    const del = await context.app.request(`/api/users/${target.id}`, {
      method: "DELETE",
      headers: { cookie: admin.cookie },
    });
    expect(del.status).toBe(204);

    const [row] = await context.db.select().from(users).where(eq(users.id, target.id)).limit(1);
    expect(row).toBeUndefined();

    const stillLoggedIn = await context.app.request("/api/users/me", { headers: { cookie: target.cookie } });
    expect(stillLoggedIn.status).toBe(401);
  });

  it("refuses to demote or remove the Superadmin, whoever attempts it", async () => {
    const otherAdmin = await createUserAndLogIn(context, {
      first_name: "Annie",
      last_name: "Easley",
      email: "annie@example.com",
      password: PASSWORD,
      role: "admin",
    });

    const demote = await context.app.request(`/api/users/${admin.id}`, {
      method: "PATCH",
      headers: { cookie: otherAdmin.cookie, "content-type": "application/json" },
      body: JSON.stringify({ role: "reader" }),
    });
    expect(demote.status).toBe(409);
    expect(((await demote.json()) as ApiError).error.code).toBe("superadmin_protected");

    const remove = await context.app.request(`/api/users/${admin.id}`, {
      method: "DELETE",
      headers: { cookie: otherAdmin.cookie },
    });
    expect(remove.status).toBe(409);
    expect(((await remove.json()) as ApiError).error.code).toBe("superadmin_protected");

    const [row] = await context.db.select().from(users).where(eq(users.id, admin.id)).limit(1);
    expect(row?.role).toBe("superadmin");
  });

  it("refuses User management to readers and writers", async () => {
    const reader = await createUserAndLogIn(context, {
      first_name: "Nichelle",
      last_name: "Nichols",
      email: "nichelle@example.com",
      password: PASSWORD,
      role: "reader",
    });
    const writer = await createUserAndLogIn(context, {
      first_name: "Christa",
      last_name: "McAuliffe",
      email: "christa@example.com",
      password: PASSWORD,
      role: "writer",
    });

    for (const session of [reader, writer]) {
      const list = await context.app.request("/api/users", { headers: { cookie: session.cookie } });
      expect(list.status).toBe(403);

      const create = await context.app.request("/api/users", {
        method: "POST",
        headers: { cookie: session.cookie, "content-type": "application/json" },
        body: JSON.stringify({ first_name: "X", last_name: "Y", email: "xy@example.com", role: "reader" }),
      });
      expect(create.status).toBe(403);

      const patchRole = await context.app.request(`/api/users/${reader.id}`, {
        method: "PATCH",
        headers: { cookie: session.cookie, "content-type": "application/json" },
        body: JSON.stringify({ role: "writer" }),
      });
      expect(patchRole.status).toBe(403);

      const remove = await context.app.request(`/api/users/${reader.id}`, {
        method: "DELETE",
        headers: { cookie: session.cookie },
      });
      expect(remove.status).toBe(403);
    }
  });

  it("refuses to create a User with an email that already exists, with a reason that says so", async () => {
    const res = await context.app.request("/api/users", {
      method: "POST",
      headers: { cookie: admin.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        first_name: "Grace",
        last_name: "Hopper",
        email: "Grace@Example.com", // same address, different case
        role: "reader",
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("email_taken");
    expect(body.error.field).toBe("email");
  });

  it("lists Users a page at a time, admin+ only", async () => {
    const res = await context.app.request("/api/users", { headers: { cookie: admin.cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiUserPage;
    expect(body.page).toBe(1);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.total).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(item).not.toHaveProperty("password_hash");
    }
  });

  it("returns 404 changing the role of, or removing, a User that doesn't exist", async () => {
    const missing = await context.app.request(`/api/users/${crypto.randomUUID()}`, {
      method: "PATCH",
      headers: { cookie: admin.cookie, "content-type": "application/json" },
      body: JSON.stringify({ role: "writer" }),
    });
    expect(missing.status).toBe(404);

    const del = await context.app.request(`/api/users/${crypto.randomUUID()}`, {
      method: "DELETE",
      headers: { cookie: admin.cookie },
    });
    expect(del.status).toBe(404);
  });

  it("refuses User management routes without a session or Token", async () => {
    const list = await context.app.request("/api/users");
    expect(list.status).toBe(401);

    const create = await context.app.request("/api/users", { method: "POST" });
    expect(create.status).toBe(401);
  });
});
