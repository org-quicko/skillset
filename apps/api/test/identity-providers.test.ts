import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Role } from "@skill-registry/shared";
import { eq } from "drizzle-orm";
import { decodeFlow, encodeFlow, OIDC_FLOW_COOKIE_NAME, safeDestination } from "../src/auth/oidc-state.js";
import { hashPassword } from "../src/auth/password.js";
import { SESSION_COOKIE_NAME } from "../src/auth/session.js";
import { identityProviders, users, type IdentityProviderRow } from "../src/db/schema.js";
import { createLogger } from "../src/logger.js";
import { resolveUserFromClaims } from "../src/services/oidc.js";
import { startTestContext, stopTestContext, type TestContext } from "./setup.js";

interface ApiError {
  error: { code: string; message: string; field?: string };
}

interface ApiProvider {
  id: string;
  slug: string;
  kind: string;
  display_name: string;
  issuer_url: string;
  client_id: string;
  permitted_domain: string | null;
  enabled: boolean;
}

interface Session {
  cookie: string;
  id: string;
}

const PASSWORD = "correct-horse-battery";
const SILENT = createLogger("silent");

function sessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("Response did not set a session cookie.");
  const match = new RegExp(`${SESSION_COOKIE_NAME}=([^;]*)`).exec(setCookie);
  if (!match) throw new Error(`Set-Cookie header missing "${SESSION_COOKIE_NAME}": ${setCookie}`);
  return `${SESSION_COOKIE_NAME}=${match[1]}`;
}

async function createUserAndLogIn(context: TestContext, email: string, role: Role): Promise<Session> {
  const [row] = await context.db
    .insert(users)
    .values({
      first_name: "Test",
      last_name: "User",
      email,
      password_hash: await hashPassword(PASSWORD),
      role,
    })
    .returning();
  if (!row) throw new Error("Insert did not return the created User.");

  const res = await context.app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status}`);
  return { cookie: sessionCookie(res), id: row.id };
}

function providerBody(overrides: Record<string, unknown> = {}) {
  return {
    slug: "google",
    kind: "google",
    display_name: "Google Workspace",
    issuer_url: "https://accounts.google.com",
    client_id: "client-id",
    client_secret: "client-secret",
    permitted_domain: "example.com",
    ...overrides,
  };
}

/** Inserted directly: most cases here don't concern the create route itself. */
async function seedProvider(
  context: TestContext,
  overrides: Partial<IdentityProviderRow> = {},
): Promise<IdentityProviderRow> {
  const [row] = await context.db
    .insert(identityProviders)
    .values({
      slug: "seeded",
      kind: "google",
      display_name: "Seeded",
      issuer_url: "https://accounts.google.com",
      client_id: "client-id",
      client_secret: "client-secret",
      permitted_domain: "example.com",
      enabled: true,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("Insert did not return the created Identity Provider.");
  return row;
}

/**
 * Seam 1 — the API request boundary: no server listens, `app.request(...)`
 * calls the Hono app directly against a real Postgres.
 *
 * The handshake itself is not exercised end-to-end: that needs a real
 * authorization server, and standing one up would be testing openid-client
 * rather than this Registry. What is tested is everything either side of it —
 * configuration and its rules, what the login page is offered, the state/nonce
 * binding that runs before a token is exchanged, and the claims-to-User
 * resolution that runs after.
 */
describe("Identity Providers and external login (ADR-0015)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;
  let admin: Session;
  let writer: Session;

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
    if (signUp.status !== 201 && signUp.status !== 200) {
      throw new Error(`Setup failed: ${signUp.status}`);
    }
    admin = { cookie: sessionCookie(signUp), id: "" };
    writer = await createUserAndLogIn(context, "writer@example.com", "writer");
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  async function clearProviders() {
    await context.db.delete(identityProviders);
  }

  describe("configuration", () => {
    it("lets an Admin create a Provider, and never returns its client secret", async () => {
      await clearProviders();
      const res = await context.app.request("/api/identity-providers", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: admin.cookie },
        body: JSON.stringify(providerBody()),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as ApiProvider & { client_secret?: string };
      expect(body.slug).toBe("google");
      expect(body.enabled).toBe(false);
      expect(body).not.toHaveProperty("client_secret");
    });

    it("never returns a client secret in the Admin's list either", async () => {
      await clearProviders();
      await seedProvider(context);

      const res = await context.app.request("/api/identity-providers", { headers: { cookie: admin.cookie } });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { items: ApiProvider[] };
      expect(body.items).toHaveLength(1);
      expect(JSON.stringify(body)).not.toContain("client-secret");
    });

    it("refuses to create a Provider enabled with no permitted domain", async () => {
      await clearProviders();
      const res = await context.app.request("/api/identity-providers", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: admin.cookie },
        body: JSON.stringify(providerBody({ enabled: true, permitted_domain: null })),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as ApiError;
      expect(body.error.code).toBe("provider_ungated");
      expect(body.error.field).toBe("permitted_domain");
    });

    it("refuses to enable an existing Provider that has no permitted domain", async () => {
      await clearProviders();
      const provider = await seedProvider(context, { enabled: false, permitted_domain: null });

      const res = await context.app.request(`/api/identity-providers/${provider.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: admin.cookie },
        body: JSON.stringify({ enabled: true }),
      });

      expect(res.status).toBe(400);
      expect(((await res.json()) as ApiError).error.code).toBe("provider_ungated");
    });

    it("refuses to clear the permitted domain of a Provider that stays enabled", async () => {
      await clearProviders();
      const provider = await seedProvider(context, { enabled: true });

      const res = await context.app.request(`/api/identity-providers/${provider.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: admin.cookie },
        body: JSON.stringify({ permitted_domain: null }),
      });

      expect(res.status).toBe(400);
      expect(((await res.json()) as ApiError).error.code).toBe("provider_ungated");
    });

    it("refuses a second Provider with a slug already taken", async () => {
      await clearProviders();
      await seedProvider(context, { slug: "google" });

      const res = await context.app.request("/api/identity-providers", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: admin.cookie },
        body: JSON.stringify(providerBody({ slug: "google" })),
      });

      expect(res.status).toBe(409);
      expect(((await res.json()) as ApiError).error.code).toBe("slug_taken");
    });

    it("leaves the slug alone when one is sent to the update route", async () => {
      await clearProviders();
      const provider = await seedProvider(context, { slug: "google" });

      const res = await context.app.request(`/api/identity-providers/${provider.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: admin.cookie },
        body: JSON.stringify({ slug: "renamed", display_name: "Renamed" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as ApiProvider;
      expect(body.slug).toBe("google");
      expect(body.display_name).toBe("Renamed");
    });

    it("keeps the stored client secret when an update omits one", async () => {
      await clearProviders();
      const provider = await seedProvider(context, { client_secret: "original-secret" });

      const res = await context.app.request(`/api/identity-providers/${provider.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: admin.cookie },
        body: JSON.stringify({ display_name: "Still configured" }),
      });
      expect(res.status).toBe(200);

      const [row] = await context.db
        .select()
        .from(identityProviders)
        .where(eq(identityProviders.id, provider.id));
      expect(row?.client_secret).toBe("original-secret");
    });

    it("has no route that deletes a Provider", async () => {
      await clearProviders();
      const provider = await seedProvider(context);

      const res = await context.app.request(`/api/identity-providers/${provider.id}`, {
        method: "DELETE",
        headers: { cookie: admin.cookie },
      });

      expect(res.status).toBe(404);
      const [row] = await context.db
        .select()
        .from(identityProviders)
        .where(eq(identityProviders.id, provider.id));
      expect(row).toBeDefined();
    });

    it("refuses configuration to a writer, and to a visitor with no session", async () => {
      await clearProviders();
      const asWriter = await context.app.request("/api/identity-providers", {
        headers: { cookie: writer.cookie },
      });
      expect(asWriter.status).toBe(403);

      const anonymous = await context.app.request("/api/identity-providers");
      expect(anonymous.status).toBe(401);

      const writerCreate = await context.app.request("/api/identity-providers", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: writer.cookie },
        body: JSON.stringify(providerBody()),
      });
      expect(writerCreate.status).toBe(403);
    });
  });

  describe("what the login page is offered", () => {
    it("lists only enabled Providers, with no secrets, to a visitor with no session", async () => {
      await clearProviders();
      await seedProvider(context, { slug: "on", display_name: "On", enabled: true });
      await seedProvider(context, { slug: "off", display_name: "Off", enabled: false });

      const res = await context.app.request("/api/auth/providers");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { items: Array<Record<string, unknown>> };
      expect(body.items).toEqual([{ slug: "on", kind: "google", display_name: "On" }]);
    });

    it("is an empty list when nothing is configured, so the login page is unchanged", async () => {
      await clearProviders();
      const res = await context.app.request("/api/auth/providers");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ items: [] });
    });
  });

  describe("the handshake", () => {
    it("refuses to start a login through a disabled Provider", async () => {
      await clearProviders();
      await seedProvider(context, { slug: "off", enabled: false });

      const res = await context.app.request("/api/auth/providers/off/start");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toStartWith("/login?error=");
      expect(res.headers.get("set-cookie") ?? "").not.toContain(SESSION_COOKIE_NAME);
    });

    it("refuses to start a login through a slug that does not exist", async () => {
      await clearProviders();
      const res = await context.app.request("/api/auth/providers/nope/start");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toStartWith("/login?error=");
    });

    it("refuses a callback from a browser with no login in progress", async () => {
      await clearProviders();
      await seedProvider(context, { slug: "google" });

      const state = encodeFlow({ nonce: "n", provider: "google", destination: "/" });
      const res = await context.app.request(`/api/auth/callback?code=abc&state=${state}`);

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toStartWith("/login?error=");
      expect(res.headers.get("set-cookie") ?? "").not.toContain(`${SESSION_COOKIE_NAME}=ey`);
    });

    it("refuses a flow begun against one Provider and returned against another", async () => {
      await clearProviders();
      await seedProvider(context, { slug: "google", enabled: true });
      await seedProvider(context, { slug: "microsoft", kind: "microsoft", enabled: true });

      const started = { nonce: "shared-nonce", provider: "google", destination: "/" };
      const returned = encodeFlow({ ...started, provider: "microsoft" });

      const res = await context.app.request(`/api/auth/callback?code=abc&state=${returned}`, {
        headers: { cookie: `${OIDC_FLOW_COOKIE_NAME}=${encodeFlow(started)}` },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toStartWith("/login?error=");
      expect(res.headers.get("set-cookie") ?? "").not.toContain(`${SESSION_COOKIE_NAME}=ey`);
    });

    it("round-trips a flow through its state encoding, and rejects a malformed one", () => {
      const flow = { nonce: "abc", provider: "google", destination: "/skills" };
      expect(decodeFlow(encodeFlow(flow))).toEqual(flow);

      expect(decodeFlow(undefined)).toBeNull();
      expect(decodeFlow("not-base64-json")).toBeNull();
      expect(decodeFlow(Buffer.from('{"nonce":"a"}', "utf8").toString("base64url"))).toBeNull();
    });

    it("never follows a destination outside this Registry", () => {
      expect(safeDestination("/skills/abc")).toBe("/skills/abc");
      expect(safeDestination("https://evil.example")).toBe("/");
      expect(safeDestination("//evil.example")).toBe("/");
      expect(safeDestination(undefined)).toBe("/");
    });
  });

  describe("who a login resolves to", () => {
    it("creates a reader with no password on a first login", async () => {
      await clearProviders();
      const provider = await seedProvider(context);

      const user = await resolveUserFromClaims({ db: context.db, logger: SILENT }, provider, {
        email: "newcomer@example.com",
        claims: { given_name: "New", family_name: "Comer" },
      });

      expect(user.role).toBe("reader");
      expect(user.password_hash).toBeNull();
      expect(user.must_change_password).toBe(false);
      expect(user.first_name).toBe("New");
      expect(user.last_name).toBe("Comer");
    });

    it("signs into an existing User without touching their role", async () => {
      await clearProviders();
      const provider = await seedProvider(context);
      await createUserAndLogIn(context, "existing-admin@example.com", "admin");

      const user = await resolveUserFromClaims({ db: context.db, logger: SILENT }, provider, {
        email: "existing-admin@example.com",
        claims: {},
      });

      expect(user.role).toBe("admin");
      expect(user.email).toBe("existing-admin@example.com");
    });

    it("is the same User through a second Provider asserting the same email", async () => {
      await clearProviders();
      const google = await seedProvider(context, { slug: "google", kind: "google" });
      const entra = await seedProvider(context, { slug: "entra", kind: "microsoft" });

      const first = await resolveUserFromClaims({ db: context.db, logger: SILENT }, google, {
        email: "both@example.com",
        claims: { given_name: "Both", family_name: "Ways" },
      });
      const second = await resolveUserFromClaims({ db: context.db, logger: SILENT }, entra, {
        email: "both@example.com",
        claims: { given_name: "Both", family_name: "Ways" },
      });

      expect(second.id).toBe(first.id);

      const rows = await context.db.select().from(users).where(eq(users.email, "both@example.com"));
      expect(rows).toHaveLength(1);
    });

    it("resolves two simultaneous first logins to one User", async () => {
      await clearProviders();
      const provider = await seedProvider(context);

      const [a, b] = await Promise.all([
        resolveUserFromClaims({ db: context.db, logger: SILENT }, provider, {
          email: "raced@example.com",
          claims: {},
        }),
        resolveUserFromClaims({ db: context.db, logger: SILENT }, provider, {
          email: "raced@example.com",
          claims: {},
        }),
      ]);

      expect(a.id).toBe(b.id);
      const rows = await context.db.select().from(users).where(eq(users.email, "raced@example.com"));
      expect(rows).toHaveLength(1);
    });

    it("still produces a name when the provider sends no name claims", async () => {
      await clearProviders();
      const provider = await seedProvider(context);

      const user = await resolveUserFromClaims({ db: context.db, logger: SILENT }, provider, {
        email: "nameless@example.com",
        claims: {},
      });

      expect(user.first_name).toBe("nameless");
      expect(user.last_name).toBe("");
    });
  });

  describe("invariants that must not drift", () => {
    it("keeps the initialisation route unavailable once any User exists", async () => {
      const res = await context.app.request("/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          first_name: "Second",
          last_name: "Superadmin",
          email: "second@example.com",
          password: PASSWORD,
        }),
      });

      expect(res.status).toBe(409);
      expect(((await res.json()) as ApiError).error.code).toBe("already_initialized");
    });

    it("cannot mint anything above a reader, whatever the Provider says", async () => {
      await clearProviders();
      // A Provider row carries no role at all — the column does not exist, so
      // there is nothing for a misconfiguration to set (ADR-0015).
      const provider = await seedProvider(context);
      expect(provider).not.toHaveProperty("role");

      const user = await resolveUserFromClaims({ db: context.db, logger: SILENT }, provider, {
        email: "always-reader@example.com",
        claims: {},
      });
      expect(user.role).toBe("reader");
    });
  });
});
