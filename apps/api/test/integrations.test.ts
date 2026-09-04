import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Role } from "@skill-registry/shared";
import { eq } from "drizzle-orm";
import { connections, integrations, users } from "../src/db/schemas/index.js";
import {
  seedUserWithPassword,
  sessionCookie,
  signIn,
  startTestContext,
  stopTestContext,
  type TestContext,
} from "./setup.js";

interface ApiError {
  error: { code: string; message: string; field?: string };
}

interface ApiIntegration {
  id: string;
  provider: string;
  display_name: string;
  description: string | null;
  client_id: string;
  app_slug: string | null;
  created_at: string;
  updated_at: string;
}

interface Session {
  cookie: string;
}

const PASSWORD = "correct-horse-battery";

async function createUserAndLogIn(context: TestContext, email: string, role: Role): Promise<Session> {
  await seedUserWithPassword(context, {
    first_name: "Test",
    last_name: "User",
    email,
    password: PASSWORD,
    role,
  });
  return { cookie: await signIn(context, email, PASSWORD) };
}

function integrationBody(overrides: Record<string, unknown> = {}) {
  return {
    provider: "github",
    display_name: "GitHub",
    client_id: "Iv1.client-id",
    client_secret: "client-secret",
    app_slug: "acme-skill-registry",
    ...overrides,
  };
}

/**
 * Seam 1 — the API request boundary: no server listens, `app.request(...)`
 * calls the Hono app directly against a real Postgres.
 *
 * What is ours here is narrow and worth being exact about: an Integration is
 * the Registry's registration with a Git Provider, its existence is the only
 * switch Importing has, and its `client_secret` must never come back out. The
 * OAuth handshake it enables is not exercised — that arrives with the
 * Connection routes.
 */
describe("Integrations (ADR-0024)", () => {
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
    if (signUp.status !== 201 && signUp.status !== 200) {
      throw new Error(`Setup failed: ${signUp.status}`);
    }
    admin = { cookie: sessionCookie(signUp) };
    writer = await createUserAndLogIn(context, "writer@example.com", "writer");
    reader = await createUserAndLogIn(context, "reader@example.com", "reader");
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  async function clearIntegrations() {
    // Connections reference `integrations.id` with RESTRICT, so they go
    // first — that FK exists precisely so a live Integration cannot be removed
    // out from under a writer's grant.
    await context.db.delete(connections);
    await context.db.delete(integrations);
  }

  function post(cookie: string, body: Record<string, unknown>) {
    return context.app.request("/api/integrations", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /** Creates an Integration and returns its id, for tests that only need one to edit. */
  async function created(cookie: string, body: Record<string, unknown> = {}): Promise<string> {
    const res = await post(cookie, integrationBody(body));
    return ((await res.json()) as ApiIntegration).id;
  }

  function patch(cookie: string, id: string, body: Record<string, unknown>) {
    return context.app.request(`/api/integrations/${id}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function del(cookie: string, id: string) {
    return context.app.request(`/api/integrations/${id}`, { method: "DELETE", headers: { cookie } });
  }

  describe("configuration", () => {
    it("lets an Admin register a Git Provider, and never returns its client secret", async () => {
      await clearIntegrations();
      const res = await post(admin.cookie, integrationBody());

      expect(res.status).toBe(201);
      const body = (await res.json()) as ApiIntegration;
      expect(body.provider).toBe("github");
      expect(body.display_name).toBe("GitHub");
      expect(body.client_id).toBe("Iv1.client-id");
      expect(body.app_slug).toBe("acme-skill-registry");
      expect(body).not.toHaveProperty("client_secret");
    });

    it("stores a description and treats an omitted one as null", async () => {
      await clearIntegrations();
      const withDescription = (await (
        await post(admin.cookie, integrationBody({ description: "Platform team's private repos." }))
      ).json()) as ApiIntegration;
      expect(withDescription.description).toBe("Platform team's private repos.");

      await clearIntegrations();
      const withoutDescription = (await (await post(admin.cookie, integrationBody())).json()) as ApiIntegration;
      expect(withoutDescription.description).toBeNull();
    });

    it("refuses a description longer than 180 characters", async () => {
      await clearIntegrations();
      const res = await post(admin.cookie, integrationBody({ description: "x".repeat(181) }));

      expect(res.status).toBe(400);
      expect(((await res.json()) as ApiError).error.field).toBe("description");
    });

    it("stores the client secret even though it is never read back", async () => {
      await clearIntegrations();
      await post(admin.cookie, integrationBody({ client_secret: "the-real-secret" }));

      const [row] = await context.db.select().from(integrations);
      expect(row?.client_secret).toBe("the-real-secret");
    });

    it("lists every configured Integration for an Admin, without secrets", async () => {
      await clearIntegrations();
      await post(admin.cookie, integrationBody());
      await post(admin.cookie, integrationBody({ provider: "gitlab", display_name: "GitLab", app_slug: null }));

      const res = await context.app.request("/api/integrations", { headers: { cookie: admin.cookie } });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { items: ApiIntegration[] };
      expect(body.items.map((item) => item.provider).sort()).toEqual(["github", "gitlab"]);
      // The whole response, serialised — a secret cannot hide in a nested shape.
      expect(JSON.stringify(body)).not.toContain("client-secret");
    });

    it("allows a second Integration for the same Git Provider (ADR-0025)", async () => {
      await clearIntegrations();
      const first = await post(admin.cookie, integrationBody());
      expect(first.status).toBe(201);

      const res = await post(admin.cookie, integrationBody({ display_name: "GitHub again" }));
      expect(res.status).toBe(201);
      const second = (await res.json()) as ApiIntegration;
      const firstId = ((await first.json()) as ApiIntegration).id;
      // Two distinct rows, each addressable by its own id — `provider` is no
      // longer the row's identity.
      expect(second.id).not.toBe(firstId);
      expect(second.provider).toBe("github");

      const items = ((await (await context.app.request("/api/integrations", { headers: { cookie: admin.cookie } })).json()) as {
        items: ApiIntegration[];
      }).items;
      expect(items.map((item) => item.id).sort()).toEqual([firstId, second.id].sort());
    });

    it("accepts a provider with no installation step, whose app slug is null", async () => {
      await clearIntegrations();
      const res = await post(admin.cookie, integrationBody({ provider: "gitlab", app_slug: null }));

      expect(res.status).toBe(201);
      expect(((await res.json()) as ApiIntegration).app_slug).toBeNull();
    });

    it("treats an omitted app slug as none, for a provider that needs none", async () => {
      await clearIntegrations();
      const { app_slug: _omitted, ...body } = integrationBody({ provider: "gitlab" });
      const res = await post(admin.cookie, body);

      expect(res.status).toBe(201);
      expect(((await res.json()) as ApiIntegration).app_slug).toBeNull();
    });

    it("refuses an Integration with no app slug when its install URL is built from one", async () => {
      await clearIntegrations();
      // Without this, `/connections/github/start` would redirect a writer to
      // `https://github.com/apps//installations/new` — a provider 404 they
      // cannot diagnose. Refused where the Admin can act on it instead.
      const { app_slug: _omitted, ...body } = integrationBody();
      const res = await post(admin.cookie, body);

      expect(res.status).toBe(400);
      expect(((await res.json()) as ApiError).error.field).toBe("app_slug");
    });

    it("refuses clearing an app slug the install URL still needs", async () => {
      await clearIntegrations();
      const id = await created(admin.cookie);

      const res = await patch(admin.cookie, id, { app_slug: null });
      expect(res.status).toBe(400);
      expect((await context.db.select().from(integrations))[0]?.app_slug).toBe("acme-skill-registry");
    });
  });

  describe("what a provider name may be", () => {
    it("refuses a Git Provider this Registry does not read from", async () => {
      await clearIntegrations();
      // The only list of valid names is GIT_PROVIDERS in shared. Bitbucket is
      // out of scope by ADR-0024, so it has no config and cannot be registered.
      const res = await post(admin.cookie, integrationBody({ provider: "bitbucket" }));

      expect(res.status).toBe(400);
      expect(((await res.json()) as ApiError).error.field).toBe("provider");
    });

    it("refuses an Identity-Provider-only kind, which is not a Git Provider", async () => {
      await clearIntegrations();
      // `google` is a way to sign in, never a place a Skill is read from. The
      // two lists overlap in exactly one member, which is why they are separate.
      expect((await post(admin.cookie, integrationBody({ provider: "google" }))).status).toBe(400);
    });

    it("refuses an app slug that could not appear in an installation URL", async () => {
      await clearIntegrations();
      // It is interpolated into `https://github.com/apps/{app_slug}/installations/new`.
      for (const app_slug of ["../../evil", "has spaces", "slash/es"]) {
        const res = await post(admin.cookie, integrationBody({ app_slug }));
        expect(res.status).toBe(400);
      }
    });
  });

  describe("editing", () => {
    it("changes a field and leaves the client secret alone when it is omitted", async () => {
      await clearIntegrations();
      const id = await created(admin.cookie, { client_secret: "original-secret" });

      const res = await patch(admin.cookie, id, { display_name: "GitHub (work)" });
      expect(res.status).toBe(200);
      expect(((await res.json()) as ApiIntegration).display_name).toBe("GitHub (work)");

      const [row] = await context.db.select().from(integrations);
      expect(row?.client_secret).toBe("original-secret");
    });

    it("replaces the client secret when one is given", async () => {
      await clearIntegrations();
      const id = await created(admin.cookie, { client_secret: "original-secret" });

      expect((await patch(admin.cookie, id, { client_secret: "rotated-secret" })).status).toBe(200);

      const [row] = await context.db.select().from(integrations);
      expect(row?.client_secret).toBe("rotated-secret");
    });

    it("changes the description, and clears it when sent null", async () => {
      await clearIntegrations();
      const id = await created(admin.cookie, { description: "Original description." });

      const changed = await patch(admin.cookie, id, { description: "Updated description." });
      expect(changed.status).toBe(200);
      expect(((await changed.json()) as ApiIntegration).description).toBe("Updated description.");

      const cleared = await patch(admin.cookie, id, { description: null });
      expect(((await cleared.json()) as ApiIntegration).description).toBeNull();
    });

    it("leaves the description alone when the field is omitted", async () => {
      await clearIntegrations();
      const id = await created(admin.cookie, { description: "Keep me." });

      expect((await patch(admin.cookie, id, { display_name: "GitHub" })).status).toBe(200);
      expect((await context.db.select().from(integrations))[0]?.description).toBe("Keep me.");
    });

    it("leaves an app slug alone when the field is omitted", async () => {
      await clearIntegrations();
      const id = await created(admin.cookie, { app_slug: "acme-registry" });

      expect((await patch(admin.cookie, id, { display_name: "GitHub" })).status).toBe(200);
      expect((await context.db.select().from(integrations))[0]?.app_slug).toBe("acme-registry");
    });

    it("cannot repoint an Integration at a different Git Provider", async () => {
      await clearIntegrations();
      const id = await created(admin.cookie);

      // `provider` is not on the update schema at all, so the schema has no
      // such field and sending one changes nothing rather than moving the
      // registration.
      expect((await patch(admin.cookie, id, { provider: "gitlab" })).status).toBe(200);
      expect((await context.db.select().from(integrations))[0]?.provider).toBe("github");
    });

    it("refuses an edit to an id with no Integration", async () => {
      await clearIntegrations();
      const res = await patch(admin.cookie, "00000000-0000-0000-0000-000000000000", { display_name: "GitLab" });

      expect(res.status).toBe(404);
      expect(((await res.json()) as ApiError).error.code).toBe("not_found");
    });

    it("takes effect on the next read, with no restart", async () => {
      await clearIntegrations();
      const id = await created(admin.cookie, { client_id: "before" });
      await patch(admin.cookie, id, { client_id: "after" });

      // Credentials are read per use (ADR-0019), so the next reader sees the edit.
      const res = await context.app.request("/api/integrations", { headers: { cookie: admin.cookie } });
      expect(((await res.json()) as { items: ApiIntegration[] }).items[0]?.client_id).toBe("after");
    });
  });

  /**
   * Repointing an Integration at another app invalidates every grant held
   * against it, and the rows must go with it. Left behind, they show a writer
   * "connected as …" while every Import fails — the worst of both, because the
   * interface says the remedy has already been taken.
   */
  /** Seeds a Connection held against `integrationId`, for tests exercising what happens to it. */
  async function seedConnection(integrationId: string) {
    const [user] = await context.db.select().from(users).where(eq(users.email, "ada@example.com"));
    await context.db.insert(connections).values({
      user_id: user?.id ?? "",
      provider: "github",
      integration_id: integrationId,
      external_account_id: "1",
      external_account_login: "ada-work",
      access_token: "ciphertext",
    });
  }

  describe("repointing an Integration at a different app", () => {
    it("clears the connections held against it, because their tokens are dead", async () => {
      await clearIntegrations();
      const id = await created(admin.cookie, { client_id: "Iv1.first-app" });
      await seedConnection(id);

      expect((await patch(admin.cookie, id, { client_id: "Iv1.second-app" })).status).toBe(200);
      expect(await context.db.select().from(connections)).toEqual([]);
    });

    it("keeps them when only the secret is rotated", async () => {
      await clearIntegrations();
      const id = await created(admin.cookie, { client_id: "Iv1.first-app" });
      await seedConnection(id);

      // A secret belongs to the app, not to the grant: the tokens stay valid,
      // so dropping them would cost every writer a reconnection for nothing.
      expect((await patch(admin.cookie, id, { client_secret: "rotated" })).status).toBe(200);
      expect(await context.db.select().from(connections)).toHaveLength(1);
    });

    it("keeps them when the same client id is re-saved", async () => {
      await clearIntegrations();
      const id = await created(admin.cookie, { client_id: "Iv1.first-app" });
      await seedConnection(id);

      // Re-saving an unchanged form must not be destructive.
      expect((await patch(admin.cookie, id, { client_id: "Iv1.first-app" })).status).toBe(200);
      expect(await context.db.select().from(connections)).toHaveLength(1);
    });
  });

  describe("who may configure one", () => {
    it("refuses a writer and a reader on every route", async () => {
      await clearIntegrations();
      const id = await created(admin.cookie);

      for (const session of [writer, reader]) {
        expect((await context.app.request("/api/integrations", { headers: { cookie: session.cookie } })).status).toBe(
          403,
        );
        expect((await post(session.cookie, integrationBody({ provider: "gitlab" }))).status).toBe(403);
        expect((await patch(session.cookie, id, { display_name: "nope" })).status).toBe(403);
        expect((await del(session.cookie, id)).status).toBe(403);
      }
    });

    it("refuses an unauthenticated caller on every route", async () => {
      expect((await context.app.request("/api/integrations")).status).toBe(401);
      expect(
        (
          await context.app.request("/api/integrations", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(integrationBody()),
          })
        ).status,
      ).toBe(401);
    });
  });

  describe("deleting", () => {
    it("lets an Admin remove an Integration that holds no Connection", async () => {
      await clearIntegrations();
      const id = await created(admin.cookie);

      expect((await del(admin.cookie, id)).status).toBe(204);
      expect(await context.db.select().from(integrations)).toEqual([]);
    });

    it("refuses when a Connection still references it, and leaves both rows in place", async () => {
      await clearIntegrations();
      const id = await created(admin.cookie);
      await seedConnection(id);

      const res = await del(admin.cookie, id);
      expect(res.status).toBe(409);
      expect(((await res.json()) as ApiError).error.code).toBe("integration_in_use");

      // Refused loudly, not silently — the Integration and the writer's grant
      // against it are both still there afterwards.
      expect(await context.db.select().from(integrations)).toHaveLength(1);
      expect(await context.db.select().from(connections)).toHaveLength(1);
    });

    it("refuses a delete for an id with no Integration", async () => {
      await clearIntegrations();
      const res = await del(admin.cookie, "00000000-0000-0000-0000-000000000000");

      expect(res.status).toBe(404);
      expect(((await res.json()) as ApiError).error.code).toBe("not_found");
    });
  });

  describe("an Integration's existence is the only switch importing has", () => {
    it("leaves no Integration configured on a fresh Registry", async () => {
      await clearIntegrations();
      const res = await context.app.request("/api/integrations", { headers: { cookie: admin.cookie } });

      // ADR-0024 drops the Admin-level import flag on exactly this ground: an
      // operator who wants no repository credentials in the database creates no
      // row, and "we hold none" is then a true statement about a fresh deploy.
      expect(((await res.json()) as { items: ApiIntegration[] }).items).toEqual([]);
    });

    it("is independent of whether that provider is also an Identity Provider", async () => {
      await clearIntegrations();
      // No `identity_providers` row for GitHub exists in this case, and the
      // Integration is created regardless — signing in and Importing are two
      // registrations that share nothing but a vendor.
      expect((await post(admin.cookie, integrationBody())).status).toBe(201);
    });
  });
});
