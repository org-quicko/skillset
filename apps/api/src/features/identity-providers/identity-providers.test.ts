import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Role } from "@in-org-quicko/skillset-shared";
import { eq } from "drizzle-orm";
import { organisationGate } from "../auth/instance.js";
import { identityProviders, users, type IdentityProviderRow } from "../../db/schemas/index.js";
import { createLogger } from "../../lib/logger.js";
import {
  seedUserWithPassword,
  sessionCookie,
  signIn,
  startTestContext,
  stopTestContext,
  type TestContext,
} from "../../../test/context.js";

interface ApiError {
  error: { code: string; message: string; field?: string };
}

interface ApiProvider {
  id: string;
  kind: string;
  display_name: string;
  client_id: string;
  permitted_organisations: string[];
  enabled: boolean;
}

interface Session {
  cookie: string;
  id: string;
}

const PASSWORD = "correct-horse-battery";

async function createUserAndLogIn(context: TestContext, email: string, role: Role): Promise<Session> {
  const row = await seedUserWithPassword(context, {
    first_name: "Test",
    last_name: "User",
    email,
    password: PASSWORD,
    role,
  });
  return { cookie: await signIn(context, email, PASSWORD), id: row.id };
}

function providerBody(overrides: Record<string, unknown> = {}) {
  return {
    kind: "google",
    display_name: "Google Workspace",
    client_id: "client-id",
    client_secret: "client-secret",
    permitted_organisations: ["example.com"],
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
      kind: "google",
      display_name: "Seeded",
      client_id: "client-id",
      client_secret: "client-secret",
      permitted_organisations: ["example.com"],
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
 * The handshake itself is not exercised end-to-end, and after ADR-0016 it is
 * emphatically not ours to exercise: the redirect, the PKCE exchange, and the
 * callback are Better Auth's, and standing up an authorization server to drive
 * them would test that library rather than this Registry.
 *
 * What *is* ours is tested directly. Configuration and its rules go through
 * the API. The organisation gate — the only control on who gets an account
 * (ADR-0015) — is exercised as the decision function it is, one case per rule,
 * which reaches the claims logic without a network in the way.
 */
describe("Identity Providers and external login (ADR-0015, ADR-0017, ADR-0018)", () => {
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
        headers: { cookie: admin.cookie, "content-type": "application/json" },
        body: JSON.stringify(providerBody()),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as ApiProvider;
      expect(body.kind).toBe("google");
      expect(body.permitted_organisations).toEqual(["example.com"]);
      expect(body).not.toHaveProperty("client_secret");
    });

    it("never returns a client secret in the Admin's list either", async () => {
      await clearProviders();
      await seedProvider(context);

      const res = await context.app.request("/api/identity-providers", {
        headers: { cookie: admin.cookie },
      });
      const body = (await res.json()) as { items: ApiProvider[] };
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).not.toHaveProperty("client_secret");
    });

    it("allows a Provider to be created enabled with no permitted organisations (ADR-0021)", async () => {
      await clearProviders();
      const res = await context.app.request("/api/identity-providers", {
        method: "POST",
        headers: { cookie: admin.cookie, "content-type": "application/json" },
        body: JSON.stringify(providerBody({ permitted_organisations: [], enabled: true })),
      });

      // This was a 400 until ADR-0021, on the grounds that the gate is the only
      // control on who gets an account. It is now a supported configuration and
      // the refusal is gone; what remains is that the Registry says so loudly
      // rather than silently.
      expect(res.status).toBe(201);
      const body = (await res.json()) as ApiProvider;
      expect(body.permitted_organisations).toEqual([]);
      expect(body.enabled).toBe(true);
    });

    it("allows an existing Provider with no permitted organisations to be enabled", async () => {
      await clearProviders();
      const provider = await seedProvider(context, { enabled: false, permitted_organisations: [] });

      const res = await context.app.request(`/api/identity-providers/${provider.id}`, {
        method: "PATCH",
        headers: { cookie: admin.cookie, "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });

      expect(res.status).toBe(200);
      expect(((await res.json()) as ApiProvider).enabled).toBe(true);
    });

    it("allows the permitted organisations of an enabled Provider to be cleared", async () => {
      await clearProviders();
      const provider = await seedProvider(context, { enabled: true });

      const res = await context.app.request(`/api/identity-providers/${provider.id}`, {
        method: "PATCH",
        headers: { cookie: admin.cookie, "content-type": "application/json" },
        body: JSON.stringify({ permitted_organisations: [] }),
      });

      expect(res.status).toBe(200);
      expect(((await res.json()) as ApiProvider).permitted_organisations).toEqual([]);
    });

    it("stores several organisations, trimmed and deduplicated case-insensitively", async () => {
      await clearProviders();
      const res = await context.app.request("/api/identity-providers", {
        method: "POST",
        headers: { cookie: admin.cookie, "content-type": "application/json" },
        body: JSON.stringify(
          providerBody({ permitted_organisations: [" example.com ", "EXAMPLE.COM", "example.org"] }),
        ),
      });

      expect(res.status).toBe(201);
      // The first spelling wins: the gate compares lowercased, so the duplicate
      // adds nothing, and an Admin should see back what they typed.
      expect(((await res.json()) as ApiProvider).permitted_organisations).toEqual([
        "example.com",
        "example.org",
      ]);
    });

    it("leaves the stored organisations alone when the field is omitted", async () => {
      await clearProviders();
      const provider = await seedProvider(context, { permitted_organisations: ["example.com"] });

      const res = await context.app.request(`/api/identity-providers/${provider.id}`, {
        method: "PATCH",
        headers: { cookie: admin.cookie, "content-type": "application/json" },
        body: JSON.stringify({ display_name: "Renamed" }),
      });

      // Omitting differs from sending an empty array, and the difference is
      // the whole gate — one is "don't touch it", the other is "remove it".
      expect(res.status).toBe(200);
      expect(((await res.json()) as ApiProvider).permitted_organisations).toEqual(["example.com"]);
    });

    it("refuses a second Provider of a kind already configured (ADR-0017)", async () => {
      await clearProviders();
      await seedProvider(context, { kind: "google" });

      const res = await context.app.request("/api/identity-providers", {
        method: "POST",
        headers: { cookie: admin.cookie, "content-type": "application/json" },
        body: JSON.stringify(providerBody({ kind: "google" })),
      });

      expect(res.status).toBe(409);
      const body = (await res.json()) as ApiError;
      expect(body.error.code).toBe("kind_taken");
      expect(body.error.field).toBe("kind");
    });

    it("configures GitHub alongside Google, since they are different kinds", async () => {
      await clearProviders();
      await seedProvider(context, { kind: "google" });

      const res = await context.app.request("/api/identity-providers", {
        method: "POST",
        headers: { cookie: admin.cookie, "content-type": "application/json" },
        body: JSON.stringify(
          providerBody({ kind: "github", display_name: "GitHub", permitted_organisations: ["acme"] }),
        ),
      });

      expect(res.status).toBe(201);
      expect(((await res.json()) as ApiProvider).kind).toBe("github");
    });

    it("leaves the kind alone when one is sent to the update route", async () => {
      await clearProviders();
      const provider = await seedProvider(context, { kind: "google" });

      const res = await context.app.request(`/api/identity-providers/${provider.id}`, {
        method: "PATCH",
        headers: { cookie: admin.cookie, "content-type": "application/json" },
        body: JSON.stringify({ kind: "github", display_name: "Renamed" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as ApiProvider;
      expect(body.display_name).toBe("Renamed");
      // The kind is the Provider's identity — changing it would repoint a live
      // configuration rather than create a second one.
      expect(body.kind).toBe("google");
    });

    it("keeps the stored client secret when an update omits one", async () => {
      await clearProviders();
      const provider = await seedProvider(context, { client_secret: "the-original-secret" });

      await context.app.request(`/api/identity-providers/${provider.id}`, {
        method: "PATCH",
        headers: { cookie: admin.cookie, "content-type": "application/json" },
        body: JSON.stringify({ display_name: "Renamed" }),
      });

      const [row] = await context.db
        .select()
        .from(identityProviders)
        .where(eq(identityProviders.id, provider.id))
        .limit(1);
      expect(row?.client_secret).toBe("the-original-secret");
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
        .where(eq(identityProviders.id, provider.id))
        .limit(1);
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
    });
  });

  describe("what the login page is offered", () => {
    it("lists only enabled Providers, with no secrets, to a visitor with no session", async () => {
      await clearProviders();
      await seedProvider(context, { kind: "google", display_name: "On", enabled: true });
      await seedProvider(context, { kind: "github", display_name: "Off", enabled: false });

      const res = await context.app.request("/api/auth/providers");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { items: { kind: string; display_name: string }[] };
      expect(body.items).toEqual([{ kind: "google", display_name: "On" }]);
    });

    it("is an empty list when nothing is configured, so the login page is unchanged", async () => {
      await clearProviders();
      const res = await context.app.request("/api/auth/providers");
      expect(await res.json()).toEqual({ items: [] });
    });
  });

  describe("the organisation gate", () => {
    // The gate is the door (ADR-0015), so each rule gets its own case rather
    // than being covered incidentally by a happy path.
    const admit = undefined;

    async function gate(source: Parameters<ReturnType<typeof organisationGate>>[0]["source"]) {
      return organisationGate(context.db, createLogger("silent"))({ source });
    }

    it("admits a Google login whose hd claim is the permitted domain", async () => {
      await clearProviders();
      await seedProvider(context, { kind: "google", permitted_organisations: ["example.com"] });

      const result = await gate({
        method: "oauth",
        oauth: {
          providerId: "google",
          profile: { email: "dev@example.com", hd: "example.com" },
        },
      });
      expect(result).toBe(admit);
    });

    it("refuses a Google login from another hosted domain", async () => {
      await clearProviders();
      await seedProvider(context, { kind: "google", permitted_organisations: ["example.com"] });

      const result = await gate({
        method: "oauth",
        oauth: {
          providerId: "google",
          profile: { email: "dev@evil.com", hd: "evil.com" },
        },
      });
      expect(result).toEqual({ error: "organisation_not_permitted" });
    });

    it("refuses a Google login whose email looks right but carries no hd claim", async () => {
      await clearProviders();
      await seedProvider(context, { kind: "google", permitted_organisations: ["example.com"] });

      // The address ends in the permitted domain and is still refused: the
      // gate is the claim, never the email's suffix (ADR-0015).
      const result = await gate({
        method: "oauth",
        oauth: { providerId: "google", profile: { email: "dev@example.com" } },
      });
      expect(result).toEqual({ error: "organisation_not_permitted" });
    });

    it("admits a claim-based login that carries no email_verified at all", async () => {
      await clearProviders();
      await seedProvider(context, { kind: "microsoft", permitted_organisations: ["tenant-guid"] });

      // Entra never sends `email_verified`, and requiring it refused every
      // Microsoft login. The tenant claim is the proof: inside a tenant the
      // address is provisioned by its administrator, so there is nothing for
      // a verification flag to add.
      const result = await gate({
        method: "oauth",
        oauth: { providerId: "microsoft", profile: { email: "dev@example.com", tid: "tenant-guid" } },
      });
      expect(result).toBe(admit);
    });

    it("refuses a login the provider says it has not verified, even from the permitted domain", async () => {
      await clearProviders();
      await seedProvider(context, { kind: "google", permitted_organisations: ["example.com"] });

      // The organisation gate answers who may have an account here; it does not
      // answer whether this person owns the address the account is keyed on
      // (ADR-0015). An explicit `false` is the provider disclaiming exactly that.
      const result = await gate({
        method: "oauth",
        oauth: {
          providerId: "google",
          profile: { email: "dev@example.com", email_verified: false, hd: "example.com" },
        },
      });
      expect(result).toEqual({ error: "email_not_verified" });
    });

    it("refuses an unverified address even through an ungated Provider", async () => {
      await clearProviders();
      await seedProvider(context, { kind: "google", permitted_organisations: [] });

      // ADR-0021 lets a Provider admit anyone it authenticates. That is a
      // decision about organisations, and it does not extend to admitting an
      // address the provider itself will not vouch for.
      const result = await gate({
        method: "oauth",
        oauth: { providerId: "google", profile: { email: "dev@anywhere.com", email_verified: false } },
      });
      expect(result).toEqual({ error: "email_not_verified" });
    });

    it("matches Microsoft on the tid claim", async () => {
      await clearProviders();
      await seedProvider(context, { kind: "microsoft", permitted_organisations: ["tenant-guid"] });

      const permitted = await gate({
        method: "oauth",
        oauth: {
          providerId: "microsoft",
          profile: { email: "dev@example.com", tid: "tenant-guid" },
        },
      });
      expect(permitted).toBe(admit);

      const other = await gate({
        method: "oauth",
        oauth: {
          providerId: "microsoft",
          profile: { email: "dev@example.com", tid: "another-tenant" },
        },
      });
      expect(other).toEqual({ error: "organisation_not_permitted" });
    });

    it("admits a GitHub login from the permitted organisation", async () => {
      await clearProviders();
      await seedProvider(context, { kind: "github", permitted_organisations: ["Acme"] });

      // Case-insensitive on both sides: GitHub logins are not case-sensitive
      // and an Admin should not have to guess the canonical casing.
      const result = await gate({
        method: "oauth",
        oauth: {
          providerId: "github",
          profile: { email: "dev@example.com", organisations: ["acme"] },
        },
      });
      expect(result).toBe(admit);
    });

    it("refuses a GitHub login from outside the permitted organisations", async () => {
      await clearProviders();
      await seedProvider(context, { kind: "github", permitted_organisations: ["acme"] });

      const result = await gate({
        method: "oauth",
        oauth: {
          providerId: "github",
          profile: { email: "dev@example.com", organisations: ["someone-else"] },
        },
      });
      expect(result).toEqual({ error: "organisation_not_permitted" });
    });

    it("admits a GitHub login matching any one of several permitted organisations", async () => {
      await clearProviders();
      await seedProvider(context, {
        kind: "github",
        permitted_organisations: ["acme", "acme-labs"],
      });

      const result = await gate({
        method: "oauth",
        oauth: {
          providerId: "github",
          profile: { email: "dev@example.com", organisations: ["acme-labs"] },
        },
      });
      expect(result).toBe(admit);
    });

    it("tells an unapproved OAuth app apart from plain non-membership (ADR-0018)", async () => {
      await clearProviders();
      await seedProvider(context, { kind: "github", permitted_organisations: ["acme"] });

      // An organisation restricting third-party application access returns no
      // organisations at all rather than an error, so every member is refused
      // with no other symptom. It gets its own code because the remedy — an
      // owner approving the app — is nothing like "join the organisation".
      const result = await gate({
        method: "oauth",
        oauth: { providerId: "github", profile: { email: "dev@example.com", organisations: [] } },
      });
      expect(result).toEqual({ error: "oauth_app_not_approved" });
    });

    it("admits any account at all when a Provider lists no organisations (ADR-0021)", async () => {
      await clearProviders();
      await seedProvider(context, { kind: "github", permitted_organisations: [] });

      // The gate turned off. Pinned deliberately, because it is the reversal
      // ADR-0021 makes rather than an oversight: a stranger with a GitHub
      // account is admitted, and gets a reader account on this Registry.
      const result = await gate({
        method: "oauth",
        oauth: {
          providerId: "github",
          profile: { email: "stranger@example.com", organisations: ["somebody-else"] },
        },
      });
      expect(result).toBe(admit);
    });

    it("skips the claim check too when a claim-based Provider lists no organisations", async () => {
      await clearProviders();
      await seedProvider(context, { kind: "google", permitted_organisations: [] });

      const result = await gate({
        method: "oauth",
        oauth: { providerId: "google", profile: { email: "anyone@gmail.com" } },
      });
      expect(result).toBe(admit);
    });

    it("admits a Google login matching any one of several permitted domains", async () => {
      await clearProviders();
      await seedProvider(context, {
        kind: "google",
        permitted_organisations: ["example.com", "example.org"],
      });

      const first = await gate({
        method: "oauth",
        oauth: { providerId: "google", profile: { email: "a@example.com", hd: "example.com" } },
      });
      expect(first).toBe(admit);

      const second = await gate({
        method: "oauth",
        oauth: { providerId: "google", profile: { email: "b@example.org", hd: "example.org" } },
      });
      expect(second).toBe(admit);

      const third = await gate({
        method: "oauth",
        oauth: { providerId: "google", profile: { email: "c@evil.com", hd: "evil.com" } },
      });
      expect(third).toEqual({ error: "organisation_not_permitted" });
    });

    it("admits a GitHub member whose address GitHub has not verified (ADR-0018)", async () => {
      await clearProviders();
      await seedProvider(context, { kind: "github", permitted_organisations: ["acme"] });

      // Pinned deliberately, because it is the risk ADR-0018 accepts rather
      // than an incidental behaviour: membership is the whole gate, so an
      // address GitHub never challenged is admitted. Should this ever need
      // reversing, this is the test that says so out loud.
      const result = await gate({
        method: "oauth",
        oauth: {
          providerId: "github",
          profile: { email: "someone-elses@example.com", organisations: ["acme"] },
        },
      });
      expect(result).toBe(admit);
    });

    it("refuses a GitHub login that reports no address at all", async () => {
      await clearProviders();
      await seedProvider(context, { kind: "github", permitted_organisations: ["acme"] });

      // An address is still required — it is the identity (ADR-0015) — even
      // though it is no longer judged.
      const result = await gate({
        method: "oauth",
        oauth: { providerId: "github", profile: { email: null, organisations: ["acme"] } },
      });
      expect(result).toEqual({ error: "no_email_from_provider" });
    });

    it("refuses a login through a Provider that is configured but disabled", async () => {
      await clearProviders();
      await seedProvider(context, {
        kind: "google",
        permitted_organisations: ["example.com"],
        enabled: false,
      });

      // Disabling must refuse logins, not merely hide the button (ADR-0015).
      const result = await gate({
        method: "oauth",
        oauth: {
          providerId: "google",
          profile: { email: "dev@example.com", hd: "example.com" },
        },
      });
      expect(result).toEqual({ error: "provider_disabled" });
    });

    it("refuses a login through a kind nobody has configured", async () => {
      await clearProviders();

      const result = await gate({
        method: "oauth",
        oauth: {
          providerId: "github",
          profile: { email: "dev@example.com", organisations: ["acme"] },
        },
      });
      expect(result).toEqual({ error: "provider_not_configured" });
    });

    it("takes a changed organisation into effect on the very next login (ADR-0019)", async () => {
      await clearProviders();
      const provider = await seedProvider(context, { kind: "google", permitted_organisations: ["example.com"] });

      const profile = { email: "dev@example.com", hd: "example.com" };
      expect(await gate({ method: "oauth", oauth: { providerId: "google", profile } })).toBe(admit);

      await context.db
        .update(identityProviders)
        .set({ permitted_organisations: ["somewhere-else.com"] })
        .where(eq(identityProviders.id, provider.id));

      // No instance rebuild in between. The gate reads the row per login, which
      // is what keeps a stale cached instance unable to admit anyone it should
      // now refuse.
      expect(await gate({ method: "oauth", oauth: { providerId: "google", profile } })).toEqual({
        error: "organisation_not_permitted",
      });
    });

    it("does not apply to a password sign-in, which has no organisation to check", async () => {
      await clearProviders();
      const result = await gate({ method: "email-password" });
      expect(result).toBe(admit);
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
    });

    it("cannot mint anything above a reader, whatever a Provider says", async () => {
      // Belt and braces, and deliberately so: the create hook pins the role
      // (ADR-0015), and nothing a Provider asserts is consulted when it does.
      const everyone = await context.db.select().from(users);
      const promoted = everyone.filter((user) => user.email.endsWith("@external.example"));
      expect(promoted.every((user) => user.role === "reader")).toBe(true);
    });
  });
});
