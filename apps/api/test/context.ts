import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Hono } from "hono";
import type { Role } from "@in-org-quicko/skillset-shared";
import { setPasswordCredential } from "../src/features/auth/credential.js";
import { hashPassword } from "../src/features/auth/password.js";
import { createDatabase } from "../src/db/client.js";
import { users, type UserRow } from "../src/db/schemas/index.js";
import { runMigrations, waitForDatabase } from "../src/db/migrate.js";
import { createLogger } from "../src/lib/logger.js";
import { AnalyticsService } from "../src/features/analytics/analytics.service.js";
import { FakeStorageAdapter } from "../src/storage/fake.js";
import { createApp, type AppDependencies } from "../src/app.js";

export const TEST_AUTH_SECRET = "test-auth-secret-do-not-use-in-production";

// Matches the origin Hono's `app.request("/path")` synthesises, so Better
// Auth's origin check sees a same-origin request rather than a cross-origin
// one it is right to refuse.
export const TEST_PUBLIC_URL = "http://localhost";

/** Better Auth's endpoints, named once so a rename is a single edit. */
export const SIGN_IN_PATH = "/api/auth/sign-in/email";
export const SIGN_OUT_PATH = "/api/auth/sign-out";

/**
 * Better Auth's session cookie. Unprefixed because `TEST_PUBLIC_URL` is plain
 * http — a deployment over https gets the `__Secure-` prefix instead, which is
 * why tests assert on the name through this constant rather than a literal.
 */
export const SESSION_COOKIE_NAME = "better-auth.session_token";

export interface TestContext {
  app: Hono;
  sql: ReturnType<typeof createDatabase>["sql"];
  db: ReturnType<typeof createDatabase>["db"];
  storage: FakeStorageAdapter;
}

/**
 * Seam 1 — the API request boundary: no server listens, `app.request(...)`
 * calls the Hono app directly against a real Postgres and a fake storage
 * adapter, per the spec's testing decisions.
 *
 * @param overrides - `AppDependencies` fields a specific test needs to set itself, e.g.
 * `mcpbPath` — a fixture path a test writes, rather than depending on `apps/mcp` having been
 * built. Merged over this function's own defaults.
 */
export async function startTestContext(
  overrides: Partial<Pick<AppDependencies, "mcpbPath">> = {},
): Promise<{
  context: TestContext;
  container: StartedPostgreSqlContainer;
}> {
  const container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const { sql, db } = createDatabase(container.getConnectionUri());

  await waitForDatabase(sql);
  await runMigrations(sql, db);
  // Migrations must be idempotent across restarts.
  await runMigrations(sql, db);

  const storage = new FakeStorageAdapter();
  const app = createApp({
    sql,
    db,
    storage,
    betterAuthSecret: TEST_AUTH_SECRET,
    publicUrl: TEST_PUBLIC_URL,
    logger: createLogger("silent"),
    // Off for the suite as a whole: every test signs in from the same
    // address, which the credential limiter is built to refuse. Tests that
    // are *about* the limiter build their own app with it on.
    rateLimiting: false,
    ...overrides,
  });

  return { context: { app: withTestOrigin(app), sql, db, storage }, container };
}

/**
 * Makes every request a test sends carry the Registry's own `origin`, unless
 * it sets one itself.
 *
 * @remarks
 * Mutating routes are guarded by an Origin check (`hono/csrf`, ISSUE-17), and
 * a browser supplies that header on every non-GET request by itself — so a
 * test that omits it is not reproducing a real request, it is reproducing one
 * no client makes. Defaulting it here rather than in three hundred call sites
 * keeps the tests about what they are testing; a test that is *about* the
 * Origin check passes its own header and this leaves it alone.
 *
 * @param app - The app under test.
 * @returns The same app, with `request` defaulting the header.
 */
function withTestOrigin(app: Hono): Hono {
  const original = app.request.bind(app);

  app.request = ((input: Parameters<Hono["request"]>[0], init?: RequestInit, ...rest: unknown[]) => {
    // A `Request` carries its own headers and ignores `init`, so there is
    // nothing to add to — every test passes a path.
    if (typeof input !== "string") return original(input, init, ...(rest as []));

    const headers = new Headers(init?.headers);
    if (!headers.has("origin")) headers.set("origin", TEST_PUBLIC_URL);
    return original(input, { ...init, headers }, ...(rest as []));
  }) as Hono["request"];

  return app;
}

/**
 * Seeds a User with a password, straight through the database.
 *
 * @remarks
 * The password lives in `accounts` now, not on the `users` row (ADR-0016), and
 * both are written here so a seeded User can actually sign in. Seeding rather
 * than going through `POST /users` keeps tests that are not about that route
 * independent of it.
 *
 * @param context - The test context.
 * @param body - The User's names, email, password, and role.
 * @returns The created row.
 */
export async function seedUserWithPassword(
  context: TestContext,
  body: { first_name: string; last_name: string; email: string; password: string; role: Role },
): Promise<UserRow> {
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
  return row;
}

/** The `set-cookie` value from a response, for replaying as a session. */
export function sessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("Response did not set a session cookie.");
  return setCookie.split(";")[0] as string;
}

/**
 * Signs in through Better Auth and returns the session cookie.
 *
 * @param context - The test context.
 * @param email - The User's email.
 * @param password - Their password.
 * @returns The cookie header to replay on subsequent requests.
 * @throws Error if the sign-in did not succeed.
 */
export async function signIn(context: TestContext, email: string, password: string): Promise<string> {
  const res = await context.app.request(SIGN_IN_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`Sign-in failed for ${email}: ${res.status}`);
  return sessionCookie(res);
}

/**
 * Tears down a test context: closes the database connection and stops the
 * Postgres container.
 *
 * @param context - The test context returned by `startTestContext`.
 * @param container - The Postgres container returned by `startTestContext`.
 */
export async function stopTestContext(
  context: TestContext,
  container: StartedPostgreSqlContainer,
): Promise<void> {
  await context.sql.end();
  await container.stop();
}

/**
 * Refreshes `skill_analytics` directly, giving a test a deterministic point to
 * assert an install count from rather than waiting on the cron schedule
 * `server.ts` owns (ADR-0012).
 *
 * @param context - The test context.
 */
export async function refreshInstallCounts(context: TestContext): Promise<void> {
  await new AnalyticsService(context.db, createLogger("silent")).refreshInstallCounts();
}
