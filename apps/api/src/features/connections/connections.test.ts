import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { ConnectionList, Role } from "@in-org-quicko/skillset-shared";
import type { IntegrationRow, NewConnectionRow, UserRow } from "../../db/tables.js";
import { createLogger } from "../../lib/logger.js";
import { deriveKeys, openSecret } from "../../lib/secrets.js";
import { ConnectionsService } from "./connections.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import {
  seedUserWithPassword,
  sessionCookie,
  signIn,
  startTestContext,
  stopTestContext,
  TEST_AUTH_SECRET,
  type TestContext,
} from "../../../test/context.js";

/**
 * Reads a stored grant back, under the key the service actually encrypts with
 * — derived from the signing secret rather than the secret itself (ISSUE-9).
 */
function decryptGrant(stored: string | null | undefined): Promise<string> {
  return openSecret(deriveKeys(TEST_AUTH_SECRET).connectionTokens, stored ?? "");
}

interface ApiError {
  error: { code: string; message: string; field?: string };
}

const PASSWORD = "correct-horse-battery";
const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";

interface Stub {
  fetch: typeof fetch;
  urls: string[];
  bodies: string[];
  redirects: (string | undefined)[];
}

/**
 * A `fetch` answering from a fixture map. Unmapped URLs 404, which is what
 * makes "it never asked for that" an assertable outcome — the refresh tests
 * depend on it.
 */
function stub(routes: Record<string, unknown>): Stub {
  const result: Stub = { fetch: null as never, urls: [], bodies: [], redirects: [] };

  result.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    result.urls.push(url);
    result.redirects.push(init?.redirect);
    if (typeof init?.body === "string") result.bodies.push(init.body);

    const body = routes[url];
    if (body === undefined) return new Response("not found", { status: 404 });
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  return result;
}

/** A token-exchange response shaped as GitHub sends one. */
function exchange(overrides: Record<string, unknown> = {}) {
  return {
    access_token: "ghu_fresh_access",
    expires_in: 28_800,
    refresh_token: "ghr_fresh_refresh",
    refresh_token_expires_in: 15_897_600,
    token_type: "bearer",
    ...overrides,
  };
}

/** The connected account, as `GET /user` reports it. */
const ACCOUNT = { id: 4_242, login: "ada-work" };

/**
 * Seam 1 — the API request boundary, plus the Connections service driven
 * directly where a stubbed provider or a moved clock is the only way to reach
 * a branch. The stub goes in at the existing `fetchImpl` parameter, never by
 * monkey-patching a global, and no request leaves the process.
 *
 * What is deliberately not tested is a real GitHub round trip: that would test
 * GitHub. What is tested is what this Registry is responsible for — who may
 * connect, that a Connection is not an identity, the CSRF surface of the
 * callback, and that a token never leaves the server.
 */
describe("Connections (ADR-0024)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;
  let adminCookie: string;
  let writerCookie: string;
  let writer: UserRow;
  let otherWriter: UserRow;
  let readerCookie: string;
  let service: ConnectionsService;
  let integrationsService: IntegrationsService;
  let logger: ReturnType<typeof createLogger>;

  async function seedUser(email: string, role: Role): Promise<{ row: UserRow; cookie: string }> {
    const row = await seedUserWithPassword(context, {
      first_name: "Test",
      last_name: "User",
      email,
      password: PASSWORD,
      role,
    });
    return { row, cookie: await signIn(context, email, PASSWORD) };
  }

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
    if (signUp.status !== 201 && signUp.status !== 200) throw new Error(`Setup failed: ${signUp.status}`);
    adminCookie = sessionCookie(signUp);

    const w = await seedUser("writer@example.com", "writer");
    writer = w.row;
    writerCookie = w.cookie;
    const o = await seedUser("other@example.com", "writer");
    otherWriter = o.row;
    readerCookie = (await seedUser("reader@example.com", "reader")).cookie;

    logger = createLogger("silent");
    integrationsService = new IntegrationsService(context.db, logger, deriveKeys(TEST_AUTH_SECRET));
    service = new ConnectionsService(context.db, TEST_AUTH_SECRET, logger, integrationsService);
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  async function seedIntegration(
    provider = "github",
    app_slug: string | null = "acme-registry",
  ): Promise<IntegrationRow> {
    await context.db.deleteFrom("connections").execute();
    await context.db.deleteFrom("integrations").execute();
    return context.db
      .insertInto("integrations")
      .values({
        provider,
        display_name: provider,
        client_id: "Iv1.client",
        client_secret: "the-secret",
        app_slug,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  function start(cookie: string, provider = "github", integrationId?: string) {
    const query = integrationId ? `?integration_id=${integrationId}` : "";
    return context.app.request(`/api/connections/${provider}/start${query}`, {
      headers: { cookie },
      redirect: "manual",
    });
  }

  function callback(cookie: string, query: string, provider = "github") {
    return context.app.request(`/api/connections/${provider}/callback?${query}`, {
      headers: { cookie },
      redirect: "manual",
    });
  }

  describe("starting a connection", () => {
    it("sends a writer to the authorize endpoint with a signed state", async () => {
      await seedIntegration();
      const res = await start(writerCookie);

      expect(res.status).toBe(302);
      const location = res.headers.get("location") ?? "";
      // The authorize endpoint, *not* the installation page: that one mints a
      // code only on a first install, so it could never reconnect a writer who
      // already had the app installed (ADR-0024).
      expect(location.startsWith(AUTHORIZE_URL)).toBe(true);
      expect(new URL(location).searchParams.get("state")).toBeTruthy();
      expect(new URL(location).searchParams.get("client_id")).toBe("Iv1.client");
    });

    it("stores the nonce in an httpOnly cookie, not in the URL", async () => {
      await seedIntegration();
      const res = await start(writerCookie);

      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie.toLowerCase()).toContain("samesite=lax");
      // The nonce must not travel where a referrer or a log could carry it.
      const nonce = /skillset_connection_state=([^;]+)/.exec(setCookie)?.[1] ?? "";
      expect(nonce.length).toBeGreaterThan(10);
      expect(res.headers.get("location") ?? "").not.toContain(nonce);
    });

    it("refuses a Git Provider with no Integration", async () => {
      await context.db.deleteFrom("connections").execute();
      await context.db.deleteFrom("integrations").execute();
      const res = await start(writerCookie);

      expect(res.status).toBe(409);
      expect(((await res.json()) as ApiError).error.code).toBe("integration_not_configured");
    });

    it("refuses a Git Provider it has never heard of, as a client error", async () => {
      await seedIntegration();
      // A path parameter, so an unknown one is caller input rather than a
      // caller bug — it must not reach `gitProviderConfig`'s plain throw and
      // surface as a 500.
      const res = await start(writerCookie, "bitbucket");

      expect(res.status).toBe(400);
      expect(((await res.json()) as ApiError).error.code).toBe("provider_not_connectable");
    });

    it("refuses a Git Provider that has no credentialed flow at all", async () => {
      // GitLab can be registered, but there is no GitLab equivalent of a GitHub
      // App — it is public-read only, and no Admin can change that (ADR-0024).
      await seedIntegration("gitlab", null);
      const res = await start(writerCookie, "gitlab");

      expect(res.status).toBe(400);
      expect(((await res.json()) as ApiError).error.code).toBe("provider_not_connectable");
    });
  });

  describe("a half-configured Integration", () => {
    // Unreachable through the API, which refuses this at configuration time —
    // seeded directly to pin down what a writer gets if it ever is reached.
    async function seedWithoutSlug() {
      return seedIntegration("github", null);
    }

    it("still lets a writer connect, because authorizing needs no app slug", async () => {
      await seedWithoutSlug();

      const res = await start(writerCookie);
      expect(res.status).toBe(302);
      expect((res.headers.get("location") ?? "").startsWith(AUTHORIZE_URL)).toBe(true);
    });

    it("offers no repository-management URL, rather than a malformed one", async () => {
      const integration = await seedWithoutSlug();

      // Never `https://github.com/apps//installations/new`, which is a provider
      // 404 a writer cannot diagnose. Null is what makes the interface say
      // "ask an administrator" instead of drawing a dead link.
      const res = await context.app.request("/api/connections", { headers: { cookie: writerCookie } });
      const body = (await res.json()) as ConnectionList;
      expect(body.connectable).toEqual([
        { id: integration.id, provider: "github", display_name: "github", app_slug: null, manage_access_url: null },
      ]);
    });
  });

  /**
   * The callback is reached by more than the connect flow, and the two extra
   * arrivals used to be reported as unverifiable attempts — which read as a
   * security failure and told the writer to retry something that had either
   * already worked or that they had just declined.
   */
  describe("callbacks that are not an authorization", () => {
    it("lands a setup redirect back in settings rather than refusing it", async () => {
      await seedIntegration();

      // A provider whose Setup URL points here fires it after an install or a
      // repository-access change: `setup_action` and no code. Nothing was
      // authorized and nothing is wrong.
      const res = await callback(writerCookie, "installation_id=42&setup_action=update");

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("/settings/connected-accounts?repositories=github");
      expect(await context.db.selectFrom("connections").selectAll().execute()).toEqual([]);
    });

    it("says so plainly when the writer declined, instead of blaming the state", async () => {
      await seedIntegration();
      const { state, nonce } = await service.start(writer, "github");

      const res = await callback(
        `${writerCookie}; skillset_connection_state=${nonce}`,
        `error=access_denied&state=${encodeURIComponent(state)}`,
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("/settings/connected-accounts?declined=github");
      expect(await context.db.selectFrom("connections").selectAll().execute()).toEqual([]);
    });
  });

  describe("the callback's state, which is the CSRF surface", () => {
    it("refuses a missing state", async () => {
      await seedIntegration();
      const res = await callback(writerCookie, "code=abc");

      expect(res.status).toBe(400);
      expect(((await res.json()) as ApiError).error.code).toBe("invalid_state");
      expect(await context.db.selectFrom("connections").selectAll().execute()).toEqual([]);
    });

    it("refuses a tampered state", async () => {
      await seedIntegration();
      const { redirect_to, nonce } = await service.start(writer, "github");
      const state = new URL(redirect_to).searchParams.get("state") ?? "";
      const tampered = `${state.slice(0, -2)}xx`;

      const res = await callback(
        `${writerCookie}; skillset_connection_state=${nonce}`,
        `code=abc&state=${encodeURIComponent(tampered)}`,
      );

      expect(res.status).toBe(400);
      expect(await context.db.selectFrom("connections").selectAll().execute()).toEqual([]);
    });

    it("refuses a state minted for a different User", async () => {
      await seedIntegration();
      // The attack this closes: tricking a victim's browser into completing
      // somebody else's authorization, attaching their GitHub to the victim.
      const { redirect_to, nonce } = await service.start(otherWriter, "github");
      const state = new URL(redirect_to).searchParams.get("state") ?? "";

      const res = await callback(
        `${writerCookie}; skillset_connection_state=${nonce}`,
        `code=abc&state=${encodeURIComponent(state)}`,
      );

      expect(res.status).toBe(400);
      expect(await context.db.selectFrom("connections").selectAll().execute()).toEqual([]);
    });

    it("refuses a state with no matching nonce cookie", async () => {
      await seedIntegration();
      const { redirect_to } = await service.start(writer, "github");
      const state = new URL(redirect_to).searchParams.get("state") ?? "";

      const res = await callback(writerCookie, `code=abc&state=${encodeURIComponent(state)}`);

      expect(res.status).toBe(400);
      expect(await context.db.selectFrom("connections").selectAll().execute()).toEqual([]);
    });

    it("refuses a nonce that does not match the one in the state", async () => {
      await seedIntegration();
      const { redirect_to } = await service.start(writer, "github");
      const state = new URL(redirect_to).searchParams.get("state") ?? "";

      const res = await callback(
        `${writerCookie}; skillset_connection_state=someone-elses-nonce`,
        `code=abc&state=${encodeURIComponent(state)}`,
      );

      expect(res.status).toBe(400);
      expect(await context.db.selectFrom("connections").selectAll().execute()).toEqual([]);
    });

    it("refuses an expired state", async () => {
      await seedIntegration();
      // A service whose clock is six minutes back mints a state whose
      // five-minute expiry has already passed. Injecting the clock is the only
      // way to reach this branch without waiting five real minutes.
      const stale = new ConnectionsService(context.db, TEST_AUTH_SECRET, logger, integrationsService, () =>
        new Date(Date.now() - 6 * 60_000),
      );
      const { state, nonce } = await stale.start(writer, "github");

      await expect(
        service.complete(writer, "github", { code: "abc", state, nonce, error: undefined }, stub({}).fetch),
      ).rejects.toThrow(/could not be verified/);
      expect(await context.db.selectFrom("connections").selectAll().execute()).toEqual([]);
    });

    it("burns the nonce, so a replay of the same callback fails", async () => {
      await seedIntegration();
      const { redirect_to, nonce } = await service.start(writer, "github");
      const state = new URL(redirect_to).searchParams.get("state") ?? "";
      const cookie = `${writerCookie}; skillset_connection_state=${nonce}`;
      const query = `code=abc&state=${encodeURIComponent(state)}`;

      const first = await callback(cookie, query);
      // The exchange itself fails here (no stub reaches the route), but the
      // response must clear the cookie either way — that is what burns it.
      expect(first.headers.get("set-cookie") ?? "").toMatch(/skillset_connection_state=;|Max-Age=0/);
    });
  });

  describe("completing a connection", () => {
    it("exchanges the code with the Integration's credentials and stores the grant", async () => {
      await seedIntegration();
      const { state, nonce } = await service.start(writer, "github");
      const provider = stub({ [TOKEN_URL]: exchange(), [USER_URL]: ACCOUNT });

      const row = await service.complete(writer, "github", { code: "the-code", state, nonce, error: undefined }, provider.fetch);

      expect(row.external_account_id).toBe("4242");
      expect(row.external_account_login).toBe("ada-work");
      expect(provider.urls).toEqual([TOKEN_URL, USER_URL]);
      // The Integration's own credential pair, not anything a caller supplied.
      expect(provider.bodies[0]).toContain("client_id=Iv1.client");
      expect(provider.bodies[0]).toContain("client_secret=the-secret");
      expect(provider.bodies[0]).toContain("code=the-code");
    });

    it("stores both tokens as ciphertext, not as tokens", async () => {
      await seedIntegration();
      const { state, nonce } = await service.start(writer, "github");
      await service.complete(
        writer,
        "github",
        { code: "c", state, nonce, error: undefined },
        stub({ [TOKEN_URL]: exchange(), [USER_URL]: ACCOUNT }).fetch,
      );

      const [row] = await context.db.selectFrom("connections").selectAll().execute();
      expect(row?.access_token).not.toBe("ghu_fresh_access");
      expect(await decryptGrant(row?.access_token)).toBe("ghu_fresh_access");
      expect(await decryptGrant(row?.refresh_token)).toBe("ghr_fresh_refresh");
    });

    it("records the expiries the provider reported", async () => {
      await seedIntegration();
      const { state, nonce } = await service.start(writer, "github");
      await service.complete(
        writer,
        "github",
        { code: "c", state, nonce, error: undefined },
        stub({ [TOKEN_URL]: exchange(), [USER_URL]: ACCOUNT }).fetch,
      );

      const [row] = await context.db.selectFrom("connections").selectAll().execute();
      const eightHours = Date.now() + 28_800_000;
      expect(row?.expires_at?.getTime()).toBeGreaterThan(eightHours - 60_000);
      expect(row?.refresh_token_expires_at).not.toBeNull();
    });

    it("accepts a grant with no expiry, which is what an app with expiry off issues", async () => {
      await seedIntegration();
      const { state, nonce } = await service.start(writer, "github");
      await service.complete(
        writer,
        "github",
        { code: "c", state, nonce, error: undefined },
        stub({
          [TOKEN_URL]: { access_token: "ghu_forever", token_type: "bearer" },
          [USER_URL]: ACCOUNT,
        }).fetch,
      );

      const [row] = await context.db.selectFrom("connections").selectAll().execute();
      expect(row?.expires_at).toBeNull();
      expect(row?.refresh_token).toBeNull();
    });

    it("replaces an existing Connection rather than adding a second", async () => {
      await seedIntegration();
      for (const login of ["first-account", "second-account"]) {
        const { state, nonce } = await service.start(writer, "github");
        await service.complete(
          writer,
          "github",
          { code: "c", state, nonce, error: undefined },
          stub({ [TOKEN_URL]: exchange(), [USER_URL]: { id: 1, login } }).fetch,
        );
      }

      const rows = await context.db.selectFrom("connections").selectAll().execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.external_account_login).toBe("second-account");
    });

    it("reports a refused exchange as such, and writes nothing", async () => {
      await seedIntegration();
      const { state, nonce } = await service.start(writer, "github");

      await expect(
        service.complete(
          writer,
          "github",
          { code: "bad", state, nonce, error: undefined },
          stub({ [TOKEN_URL]: new Response("nope", { status: 401 }) }).fetch,
        ),
      ).rejects.toThrow(/would not complete/);
      expect(await context.db.selectFrom("connections").selectAll().execute()).toEqual([]);
    });

    it("reports an exchange that returns an error body rather than a token", async () => {
      await seedIntegration();
      const { state, nonce } = await service.start(writer, "github");

      await expect(
        service.complete(
          writer,
          "github",
          { code: "bad", state, nonce, error: undefined },
          stub({ [TOKEN_URL]: { error: "bad_verification_code" } }).fetch,
        ),
      ).rejects.toThrow(/would not complete/);
      expect(await context.db.selectFrom("connections").selectAll().execute()).toEqual([]);
    });

    it("reports a 2xx that is not JSON as a refused exchange", async () => {
      await seedIntegration();
      const { state, nonce } = await service.start(writer, "github");

      // A proxy or an incident page answering 200 with HTML. It must map to the
      // same refusal as an error body rather than escaping as a parse failure.
      await expect(
        service.complete(
          writer,
          "github",
          { code: "c", state, nonce, error: undefined },
          stub({
            [TOKEN_URL]: new Response("<html>maintenance</html>", {
              status: 200,
              headers: { "content-type": "text/html" },
            }),
          }).fetch,
        ),
      ).rejects.toMatchObject({ code: "exchange_failed" });
      expect(await context.db.selectFrom("connections").selectAll().execute()).toEqual([]);
    });

    it("never follows a redirect on an outbound request", async () => {
      await seedIntegration();
      const { state, nonce } = await service.start(writer, "github");
      const provider = stub({ [TOKEN_URL]: exchange(), [USER_URL]: ACCOUNT });

      await service.complete(writer, "github", { code: "c", state, nonce, error: undefined }, provider.fetch);

      expect(new Set(provider.redirects)).toEqual(new Set(["manual"]));
    });
  });

  describe("using a Connection's token", () => {
    async function seedConnection(overrides: Partial<NewConnectionRow> = {}) {
      const integration = await seedIntegration();
      await context.db
        .insertInto("connections")
        .values({
          user_id: writer.id,
          provider: "github",
          integration_id: integration.id,
          external_account_id: "1",
          external_account_login: "ada-work",
          access_token: await encryptLegacy("ghu_stored_access"),
          refresh_token: await encryptLegacy("ghr_stored_refresh"),
          expires_at: new Date(Date.now() + 3_600_000),
          refresh_token_expires_at: new Date(Date.now() + 30 * 86_400_000),
          ...overrides,
        })
        .execute();
    }

    it("returns a token that is not close to expiring, without refreshing", async () => {
      await seedConnection();
      const provider = stub({});

      expect(await service.accessTokenFor(writer.id, "github", provider.fetch)).toBe("ghu_stored_access");
      expect(provider.urls).toEqual([]);
    });

    it("returns a non-expiring token as it is", async () => {
      await seedConnection({ expires_at: null, refresh_token: null, refresh_token_expires_at: null });
      const provider = stub({});

      expect(await service.accessTokenFor(writer.id, "github", provider.fetch)).toBe("ghu_stored_access");
      expect(provider.urls).toEqual([]);
    });

    it("refreshes a token expiring within the minute, before it has actually expired", async () => {
      // The check is "about to expire", not "has expired" — a token that dies
      // mid-import is a failure a refresh 30 seconds earlier would have avoided.
      await seedConnection({ expires_at: new Date(Date.now() + 30_000) });
      const provider = stub({ [TOKEN_URL]: exchange({ access_token: "ghu_refreshed" }) });

      expect(await service.accessTokenFor(writer.id, "github", provider.fetch)).toBe("ghu_refreshed");
      expect(provider.bodies[0]).toContain("grant_type=refresh_token");
      expect(provider.bodies[0]).toContain("refresh_token=ghr_stored_refresh");
    });

    it("persists the refreshed grant, encrypted", async () => {
      await seedConnection({ expires_at: new Date(Date.now() + 30_000) });
      await service.accessTokenFor(
        writer.id,
        "github",
        stub({ [TOKEN_URL]: exchange({ access_token: "ghu_refreshed", refresh_token: "ghr_rotated" }) }).fetch,
      );

      const [row] = await context.db.selectFrom("connections").selectAll().execute();
      expect(await decryptGrant(row?.access_token)).toBe("ghu_refreshed");
      expect(await decryptGrant(row?.refresh_token)).toBe("ghr_rotated");
      expect(row?.expires_at?.getTime()).toBeGreaterThan(Date.now() + 60_000);
    });

    it("keeps a refresh token the provider did not rotate", async () => {
      await seedConnection({ expires_at: new Date(Date.now() + 30_000) });
      // Legal OAuth, and what a provider that does not rotate refresh tokens
      // returns. Nulling the stored one would destroy a working credential and
      // leave the Connection unable to refresh ever again.
      const provider = stub({
        [TOKEN_URL]: { access_token: "ghu_refreshed", expires_in: 28_800, token_type: "bearer" },
      });

      expect(await service.accessTokenFor(writer.id, "github", provider.fetch)).toBe("ghu_refreshed");

      const [row] = await context.db.selectFrom("connections").selectAll().execute();
      // Still readable under the *legacy* key, because this refresh did not
      // rewrite it — which is the ISSUE-9 migration path working: a row
      // written before per-purpose keys keeps opening until something
      // re-encrypts it.
      expect(await decryptLegacyGrant(row?.refresh_token)).toBe("ghr_stored_refresh");
      expect(row?.expires_at).not.toBeNull();
    });

    it("does not report a network failure as an expired connection", async () => {
      await seedConnection({ expires_at: new Date(Date.now() - 1_000) });
      // Telling a writer to reconnect while the provider is unreachable is
      // advice that cannot help, and reconnecting fails for the same reason.
      const unreachable = (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch;

      await expect(service.accessTokenFor(writer.id, "github", unreachable)).rejects.not.toMatchObject({
        code: "connection_expired",
      });
    });

    it("says reconnect when a refresh is refused, and keeps the Connection", async () => {
      await seedConnection({ expires_at: new Date(Date.now() - 1_000) });
      const provider = stub({ [TOKEN_URL]: new Response("nope", { status: 401 }) });

      await expect(service.accessTokenFor(writer.id, "github", provider.fetch)).rejects.toThrow(/Reconnect/);
      // Deleting it would lose the writer's own record of what they granted.
      expect(await context.db.selectFrom("connections").selectAll().execute()).toHaveLength(1);
    });

    it("never says sign in again, which refreshes nothing after ADR-0024", async () => {
      await seedConnection({ expires_at: new Date(Date.now() - 1_000) });
      const provider = stub({ [TOKEN_URL]: new Response("nope", { status: 401 }) });

      await expect(service.accessTokenFor(writer.id, "github", provider.fetch)).rejects.not.toThrow(/[Ss]ign in/);
    });

    it("does not spend a refresh token that is itself expired", async () => {
      await seedConnection({
        expires_at: new Date(Date.now() - 1_000),
        refresh_token_expires_at: new Date(Date.now() - 1_000),
      });
      const provider = stub({ [TOKEN_URL]: exchange() });

      await expect(service.accessTokenFor(writer.id, "github", provider.fetch)).rejects.toThrow(/Reconnect/);
      // Refused without asking: the provider would refuse it anyway.
      expect(provider.urls).toEqual([]);
    });

    it("refuses when there is no Connection at all", async () => {
      await seedIntegration();
      // Asserted on the code rather than the sentence: the code is the contract
      // #35 branches on, the sentence is copy that may be reworded.
      await expect(service.accessTokenFor(writer.id, "github", stub({}).fetch)).rejects.toMatchObject({
        code: "not_connected",
      });
    });
  });

  describe("listing and disconnecting", () => {
    async function connect() {
      await seedIntegration();
      const { state, nonce } = await service.start(writer, "github");
      await service.complete(
        writer,
        "github",
        { code: "c", state, nonce, error: undefined },
        stub({ [TOKEN_URL]: exchange(), [USER_URL]: ACCOUNT }).fetch,
      );
    }

    it("returns the caller's own Connections, with no token in any shape", async () => {
      await connect();
      const res = await context.app.request("/api/connections", { headers: { cookie: writerCookie } });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect((body as { items: unknown[] }).items).toHaveLength(1);
      const serialised = JSON.stringify(body);
      expect(serialised).toContain("ada-work");
      for (const secret of ["ghu_fresh_access", "ghr_fresh_refresh", "access_token", "refresh_token"]) {
        expect(serialised).not.toContain(secret);
      }
    });

    it("does not show one writer another's Connection", async () => {
      await connect();
      const res = await context.app.request("/api/connections", { headers: { cookie: readerCookie } });

      // A reader is refused outright, so ask as the other writer instead.
      expect(res.status).toBe(403);
      const other = await signIn(context, "other@example.com", PASSWORD);
      const mine = await context.app.request("/api/connections", { headers: { cookie: other } });
      expect(((await mine.json()) as { items: unknown[] }).items).toEqual([]);
    });

    it("deletes the Connection and nothing else", async () => {
      await connect();
      const res = await context.app.request("/api/connections/github", {
        method: "DELETE",
        headers: { cookie: writerCookie },
      });

      expect(res.status).toBe(204);
      expect(await context.db.selectFrom("connections").selectAll().execute()).toEqual([]);
      // The writer's account and their ability to sign in are untouched.
      expect(await context.db.selectFrom("users").selectAll().where("id", "=", writer.id).execute()).toHaveLength(1);
      expect(await context.db.selectFrom("integrations").selectAll().execute()).toHaveLength(1);
    });

    it("refuses to disconnect what was never connected", async () => {
      await seedIntegration();
      const res = await context.app.request("/api/connections/github", {
        method: "DELETE",
        headers: { cookie: writerCookie },
      });

      expect(res.status).toBe(404);
    });
  });

  describe("who may connect", () => {
    it("refuses a reader on every route", async () => {
      await seedIntegration();
      expect((await start(readerCookie)).status).toBe(403);
      expect((await callback(readerCookie, "code=a&state=b")).status).toBe(403);
      expect((await context.app.request("/api/connections", { headers: { cookie: readerCookie } })).status).toBe(403);
      expect(
        (
          await context.app.request("/api/connections/github", {
            method: "DELETE",
            headers: { cookie: readerCookie },
          })
        ).status,
      ).toBe(403);
    });

    it("refuses an unauthenticated caller on every route", async () => {
      await seedIntegration();
      expect((await context.app.request("/api/connections")).status).toBe(401);
      expect((await context.app.request("/api/connections/github/start", { redirect: "manual" })).status).toBe(401);
      expect(
        (await context.app.request("/api/connections/github/callback?code=a&state=b", { redirect: "manual" })).status,
      ).toBe(401);
      expect((await context.app.request("/api/connections/github", { method: "DELETE" })).status).toBe(401);
    });

    it("lets an Admin connect too — the role floor is writer, not exactly writer", async () => {
      await seedIntegration();
      expect((await start(adminCookie)).status).toBe(302);
    });
  });

  describe("choosing between multiple Integrations for a provider (ADR-0025)", () => {
    async function seedSecondIntegration() {
      return context.db
        .insertInto("integrations")
        .values({
          provider: "github",
          display_name: "GitHub (second app)",
          client_id: "Iv2.client",
          client_secret: "the-second-secret",
          app_slug: "acme-registry-2",
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    }

    it("refuses to start without saying which app, when more than one is configured", async () => {
      await seedIntegration();
      await seedSecondIntegration();

      const res = await start(writerCookie);
      expect(res.status).toBe(400);
      expect(((await res.json()) as ApiError).error.code).toBe("integration_choice_required");
    });

    it("starts using the app named by integration_id", async () => {
      await seedIntegration();
      const second = await seedSecondIntegration();

      const res = await start(writerCookie, "github", second.id);
      expect(res.status).toBe(302);
      const location = res.headers.get("location") ?? "";
      expect(new URL(location).searchParams.get("client_id")).toBe("Iv2.client");
    });

    it("lists one connectable entry per app, not one per provider", async () => {
      const first = await seedIntegration();
      const second = await seedSecondIntegration();

      const res = await context.app.request("/api/connections", { headers: { cookie: writerCookie } });
      const body = (await res.json()) as ConnectionList;
      expect(body.connectable.map((entry) => entry.id).sort()).toEqual([first.id, second.id].sort());
      expect(body.connectable.every((entry) => entry.provider === "github")).toBe(true);
    });

    it("records which app a Connection was completed through", async () => {
      await seedIntegration();
      const second = await seedSecondIntegration();

      const { state, nonce } = await service.start(writer, "github", second.id);
      await service.complete(
        writer,
        "github",
        { code: "c", state, nonce, error: undefined },
        stub({ [TOKEN_URL]: exchange(), [USER_URL]: ACCOUNT }).fetch,
      );

      const [row] = await context.db.selectFrom("connections").selectAll().execute();
      expect(row?.integration_id).toBe(second.id);
    });
  });

  describe("invariants the schema carries", () => {
    it("cannot hold a Connection through an unregistered Integration", async () => {
      await seedIntegration();
      await expect(
        (async () =>
          context.db
            .insertInto("connections")
            .values({
              user_id: writer.id,
              provider: "github",
              // A well-formed id naming no Integration at all, not a malformed
              // one — this is `integration_id`'s foreign key doing the work,
              // which is what makes "you cannot connect through an app this
              // Registry has not registered" a database invariant now that
              // `provider` alone (ADR-0025) no longer carries one.
              integration_id: "00000000-0000-0000-0000-000000000000",
              external_account_id: "1",
              external_account_login: "x",
              access_token: "cipher",
            })
            .execute())(),
      ).rejects.toThrow();
    });

    it("refuses to remove an Integration writers are still connected against", async () => {
      const integration = await seedIntegration();
      await context.db
        .insertInto("connections")
        .values({
          user_id: writer.id,
          provider: "github",
          integration_id: integration.id,
          external_account_id: "1",
          external_account_login: "x",
          access_token: await encryptLegacy("ghu_x"),
        })
        .execute();

      // RESTRICT, not CASCADE: silently dropping a writer's credential when an
      // Admin tidies up configuration is the failure mode worth being loud about.
      await expect(
        (async () => context.db.deleteFrom("integrations").where("id", "=", integration.id).execute())(),
      ).rejects.toThrow();
    });

    it("removes a User's Connections with the User", async () => {
      const integration = await seedIntegration();
      const doomed = await seedUserWithPassword(context, {
        first_name: "Gone",
        last_name: "Soon",
        email: "gone@example.com",
        password: PASSWORD,
        role: "writer",
      });
      await context.db
        .insertInto("connections")
        .values({
          user_id: doomed.id,
          provider: "github",
          integration_id: integration.id,
          external_account_id: "1",
          external_account_login: "x",
          access_token: await encryptLegacy("ghu_x"),
        })
        .execute();

      await context.db.deleteFrom("users").where("id", "=", doomed.id).execute();
      expect(
        await context.db.selectFrom("connections").selectAll().where("user_id", "=", doomed.id).execute(),
      ).toEqual([]);
    });
  });
});

/** Encrypts as the service does, so a seeded row is indistinguishable from a real one. */
/**
 * Encrypts a grant the way rows written before ISSUE-9 were: bare ciphertext
 * under the signing secret itself, with no key derivation and no version
 * envelope.
 *
 * @remarks
 * Deliberately the old scheme, not the current one. Every seeded Connection
 * here is therefore a pre-migration row, so the tests that read one back are
 * also the check that `deriveKeys`' `legacySecret` fallback still opens it.
 */
async function encryptLegacy(value: string): Promise<string> {
  const { symmetricEncrypt } = await import("better-auth/crypto");
  return symmetricEncrypt({ key: TEST_AUTH_SECRET, data: value });
}

/** Reads back a grant written by {@link encryptLegacy}. */
async function decryptLegacyGrant(stored: string | null | undefined): Promise<string> {
  const { symmetricDecrypt } = await import("better-auth/crypto");
  return symmetricDecrypt({ key: TEST_AUTH_SECRET, data: stored ?? "" });
}
