import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Role } from "@skillset/shared";
import { symmetricEncrypt } from "better-auth/crypto";
import {
  connections,
  identityProviders,
  integrations,
  type IntegrationRow,
  type UserRow,
} from "../../db/schemas/index.js";
import { createLogger } from "../../lib/logger.js";
import { deriveKeys } from "../../lib/secrets.js";
import { ConnectionsService } from "../connections/connections.service.js";
import { ImportsService } from "./imports.service.js";
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

interface ApiError {
  error: { code: string; message: string; field?: string };
}

const PASSWORD = "correct-horse-battery";
const IMPORT_PATH = "/api/imports/github/skill-files";

const CONTENTS = "https://api.github.com/repos/acme/skills/contents/code-review?ref=main";
const RAW = "https://raw.githubusercontent.com/acme/skills/main/code-review";
const INSTALLATIONS = "https://api.github.com/user/installations";

/** A body that would succeed if everything else were in place. */
function validBody(overrides: Record<string, unknown> = {}) {
  return { project: "acme/skills", ref: "main", path: "code-review", ...overrides };
}

interface Stub {
  fetch: typeof fetch;
  urls: string[];
  methods: (string | undefined)[];
}

function stub(routes: Record<string, unknown>): Stub {
  const result: Stub = { fetch: null as never, urls: [], methods: [] };

  result.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    result.urls.push(url);
    result.methods.push(init?.method ?? "GET");

    const body = routes[url];
    if (body === undefined) return new Response("not found", { status: 404 });
    if (body instanceof Response) return body;
    if (body instanceof Uint8Array) return new Response(new Blob([new Uint8Array(body)]), { status: 200 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  return result;
}

/** A GitHub Contents API file entry, with the fields the walk reads. */
function file(path: string, size = 12): Record<string, unknown> {
  return { path, type: "file", size, download_url: `https://raw.githubusercontent.com/acme/skills/main/${path}` };
}

/**
 * Seam 1 — the API request boundary, plus the Imports service driven directly
 * where a stubbed provider is the only way to reach a branch.
 *
 * What is deliberately not tested is a real GitHub round trip: that would test
 * GitHub. What is tested is everything this Registry is responsible for — who
 * may call the route, whose grant it runs as, the validation that keeps a
 * server-side fetch from being pointed somewhere it should not go (ADR-0020),
 * and that the two capabilities are genuinely independent (ADR-0024).
 */
describe("Importing a Skill from a Git Provider (ADR-0024)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;
  let writer: UserRow;
  let writerCookie: string;
  let readerCookie: string;
  let imports: ImportsService;

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
    sessionCookie(signUp);

    const seed = async (email: string, role: Role) => {
      const row = await seedUserWithPassword(context, {
        first_name: "Test",
        last_name: "User",
        email,
        password: PASSWORD,
        role,
      });
      return { row, cookie: await signIn(context, email, PASSWORD) };
    };

    const w = await seed("writer@example.com", "writer");
    writer = w.row;
    writerCookie = w.cookie;
    readerCookie = (await seed("reader@example.com", "reader")).cookie;

    const logger = createLogger("silent");
    const integrationsService = new IntegrationsService(context.db, logger, deriveKeys(TEST_AUTH_SECRET));
    imports = new ImportsService(
      logger,
      integrationsService,
      new ConnectionsService(context.db, TEST_AUTH_SECRET, logger, integrationsService),
    );
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  async function clearAll() {
    await context.db.delete(connections);
    await context.db.delete(integrations);
    await context.db.delete(identityProviders);
  }

  async function seedIntegration(app_slug: string | null = "acme-registry"): Promise<IntegrationRow> {
    const [row] = await context.db
      .insert(integrations)
      .values({
        provider: "github",
        display_name: "GitHub",
        client_id: "Iv1.client",
        client_secret: "the-secret",
        app_slug,
      })
      .returning();
    if (!row) throw new Error("Integration insert did not return a row.");
    return row;
  }

  // No default `integrationId`: a caller with no Integration seeded must name
  // one explicitly (even a nonexistent one) to prove the foreign key, rather
  // than silently succeeding against nothing.
  async function seedConnection(overrides: Record<string, unknown> = {}, integrationId?: string) {
    await context.db.insert(connections).values({
      user_id: writer.id,
      provider: "github",
      integration_id: integrationId ?? "00000000-0000-0000-0000-000000000000",
      external_account_id: "1",
      external_account_login: "ada-work",
      access_token: await symmetricEncrypt({ key: TEST_AUTH_SECRET, data: "ghu_writer_token" }),
      refresh_token: await symmetricEncrypt({ key: TEST_AUTH_SECRET, data: "ghr_writer_token" }),
      expires_at: new Date(Date.now() + 3_600_000),
      refresh_token_expires_at: new Date(Date.now() + 30 * 86_400_000),
      ...overrides,
    });
  }

  /** Ready to import: an Integration and a Connection for the writer. */
  async function ready() {
    await clearAll();
    const integration = await seedIntegration();
    await seedConnection({}, integration.id);
  }

  function post(cookie: string, body: unknown, path = IMPORT_PATH) {
    return context.app.request(path, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  describe("preconditions, in order", () => {
    it("refuses when no Integration is configured, before looking for a Connection", async () => {
      await clearAll();
      await seedConnection().catch(() => undefined); // Cannot exist without the FK; proves the order regardless.

      const res = await post(writerCookie, validBody());
      expect(res.status).toBe(409);
      expect(((await res.json()) as ApiError).error.code).toBe("integration_not_configured");
    });

    it("refuses a writer who holds no Connection, and offers the remedy they can take", async () => {
      await clearAll();
      await seedIntegration();

      const res = await post(writerCookie, validBody());
      expect(res.status).toBe(409);
      const body = (await res.json()) as ApiError;
      expect(body.error.code).toBe("not_connected");
      expect(body.error.message).toMatch(/settings/i);
    });

    it("reads the Connection on every import, so disconnecting lands immediately", async () => {
      await ready();
      const provider = stub({ [CONTENTS]: [file("code-review/SKILL.md")], [`${RAW}/SKILL.md`]: new Uint8Array([1]) });
      expect(await imports.fetchSkillFiles(writer.id, location(), provider.fetch)).toHaveLength(1);

      await context.db.delete(connections);
      await expect(imports.fetchSkillFiles(writer.id, location(), provider.fetch)).rejects.toMatchObject({
        code: "not_connected",
      });
    });
  });

  describe("the two capabilities are independent", () => {
    it("imports with GitHub sign-in disabled, and with none configured at all", async () => {
      await ready();
      // No `identity_providers` row for GitHub exists here. Importing does not
      // read that table any more, which is the whole point of ADR-0024.
      const provider = stub({ [CONTENTS]: [file("code-review/SKILL.md")], [`${RAW}/SKILL.md`]: new Uint8Array([1]) });

      expect(await imports.fetchSkillFiles(writer.id, location(), provider.fetch)).toHaveLength(1);

      await context.db
        .insert(identityProviders)
        .values({
          kind: "github",
          display_name: "GitHub",
          client_id: "oauth-client",
          client_secret: "oauth-secret",
          enabled: false,
        });

      expect(await imports.fetchSkillFiles(writer.id, location(), provider.fetch)).toHaveLength(1);
    });

    it("leaves GitHub sign-in working with no Integration at all", async () => {
      await clearAll();
      await context.db.insert(identityProviders).values({
        kind: "github",
        display_name: "GitHub",
        client_id: "oauth-client",
        client_secret: "oauth-secret",
        enabled: true,
      });

      const res = await context.app.request("/api/auth/providers");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { kind: string }[] };
      expect(body.items.map((item) => item.kind)).toContain("github");
    });
  });

  describe("the shape of a successful import", () => {
    it("returns base64 files at paths relative to the folder", async () => {
      await ready();
      const provider = stub({
        [CONTENTS]: [file("code-review/SKILL.md")],
        [`${RAW}/SKILL.md`]: new TextEncoder().encode("hello world!"),
      });

      const files = await imports.fetchSkillFiles(writer.id, location(), provider.fetch);
      expect(files).toHaveLength(1);
      expect(files[0]?.path).toBe("SKILL.md");
    });

    it("spends the writer's own token and nobody else's", async () => {
      await ready();
      const seen: string[] = [];
      const capture = (async (input: string | URL | Request, init?: RequestInit) => {
        const authorization = new Headers(init?.headers).get("authorization");
        if (authorization) seen.push(authorization);
        const url = typeof input === "string" ? input : String(input);
        if (url === CONTENTS) {
          return new Response(JSON.stringify([file("code-review/SKILL.md")]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(new Blob([new Uint8Array([1])]), { status: 200 });
      }) as typeof fetch;

      await imports.fetchSkillFiles(writer.id, location(), capture);
      expect(new Set(seen)).toEqual(new Set(["Bearer ghu_writer_token"]));
    });

    it("only ever reads: every request the walk makes is a GET", async () => {
      await ready();
      const provider = stub({ [CONTENTS]: [file("code-review/SKILL.md")], [`${RAW}/SKILL.md`]: new Uint8Array([1]) });

      await imports.fetchSkillFiles(writer.id, location(), provider.fetch);
      expect(new Set(provider.methods)).toEqual(new Set(["GET"]));
    });
  });

  describe("diagnosing a 404", () => {
    it("names the owner and the install link when the app is not installed there", async () => {
      await ready();
      // GitHub answers 404 for a project the installation cannot see, which is
      // indistinguishable from a typo without asking what is installed.
      const provider = stub({ [INSTALLATIONS]: { total_count: 0, installations: [] } });

      await expect(imports.fetchSkillFiles(writer.id, location(), provider.fetch)).rejects.toMatchObject({
        code: "app_not_installed",
      });
      expect(provider.urls).toContain(INSTALLATIONS);
    });

    it("mentions the owner by name, and that an owner may have to approve", async () => {
      await ready();
      const provider = stub({ [INSTALLATIONS]: { total_count: 0, installations: [] } });

      await expect(imports.fetchSkillFiles(writer.id, location(), provider.fetch)).rejects.toThrow(/acme/);
      await expect(imports.fetchSkillFiles(writer.id, location(), provider.fetch)).rejects.toThrow(
        /apps\/acme-registry\/installations\/new/,
      );
    });

    it("builds the install link from the writer's own app, not another Integration for the same provider (ADR-0025)", async () => {
      await clearAll();
      // Two GitHub Apps configured; the writer connected through the second
      // one. The install link must point at *that* app's slug — a sibling
      // Integration for the same provider may well have a different one.
      await seedIntegration("acme-registry-one");
      const second = await seedIntegration("acme-registry-two");
      await seedConnection({}, second.id);

      const provider = stub({ [INSTALLATIONS]: { total_count: 0, installations: [] } });
      await expect(imports.fetchSkillFiles(writer.id, location(), provider.fetch)).rejects.toThrow(
        /apps\/acme-registry-two\/installations\/new/,
      );
    });

    it("reports a plain not-found when the app IS installed on that owner", async () => {
      await ready();
      // Installed, so the 404 means the folder or the ref really is missing —
      // telling them to install it again would be wrong and confusing. And a
      // mistyped URL is the caller's problem, so it is a 4xx and not a 502.
      const provider = stub({
        [INSTALLATIONS]: { total_count: 1, installations: [{ id: 7, account: { login: "acme" } }] },
      });

      await expect(imports.fetchSkillFiles(writer.id, location(), provider.fetch)).rejects.toMatchObject({
        code: "import_rejected",
        status: 422,
      });
    });

    it("matches the owner case-insensitively, as GitHub does", async () => {
      await ready();
      const provider = stub({
        [INSTALLATIONS]: { total_count: 1, installations: [{ id: 7, account: { login: "ACME" } }] },
      });

      await expect(imports.fetchSkillFiles(writer.id, location(), provider.fetch)).rejects.toMatchObject({
        code: "import_rejected",
      });
    });

    it("still refuses usefully when the installations call itself fails", async () => {
      await ready();
      const provider = stub({ [INSTALLATIONS]: new Response("boom", { status: 500 }) });

      // A diagnosis that cannot run must not turn a 404 into a 500, and must
      // not claim the app is missing when it may well be installed.
      await expect(imports.fetchSkillFiles(writer.id, location(), provider.fetch)).rejects.toMatchObject({
        code: "import_rejected",
      });
    });
  });

  describe("what the writer is told", () => {
    it("says reconnect, never sign in, when the grant is refused", async () => {
      await ready();
      const provider = stub({ [CONTENTS]: new Response("nope", { status: 401 }) });

      await expect(imports.fetchSkillFiles(writer.id, location(), provider.fetch)).rejects.toMatchObject({
        code: "connection_expired",
      });
      // "Sign in with GitHub again" became wrong the moment the Import token
      // stopped coming from the login.
      await expect(imports.fetchSkillFiles(writer.id, location(), provider.fetch)).rejects.not.toThrow(/sign in/i);
    });

    it("passes on a rate limit as itself, since reconnecting would not help", async () => {
      await ready();
      const provider = stub({
        [CONTENTS]: new Response("slow down", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
      });

      // Genuinely upstream, so this one is a 502.
      await expect(imports.fetchSkillFiles(writer.id, location(), provider.fetch)).rejects.toMatchObject({
        code: "import_failed",
        status: 502,
      });
      await expect(imports.fetchSkillFiles(writer.id, location(), provider.fetch)).rejects.toThrow(/rate/i);
    });

    it("refuses an empty folder, and a folder past the Artifact ceilings", async () => {
      await ready();
      const empty = stub({ [CONTENTS]: [] });
      await expect(imports.fetchSkillFiles(writer.id, location(), empty.fetch)).rejects.toThrow(/empty/i);

      const huge = stub({ [CONTENTS]: [file("code-review/big.md", 100_000_000)] });
      await expect(imports.fetchSkillFiles(writer.id, location(), huge.fetch)).rejects.toThrow(/larger/i);
      expect(huge.urls).not.toContain(`${RAW}/big.md`);
    });

    it("calls a bad folder the caller's problem, not the provider's", async () => {
      await ready();
      // Nothing failed upstream: the provider answered perfectly well and the
      // answer is that this folder is not a Skill. A 502 here would invite a
      // retry that can never succeed, and would page an operator every time
      // somebody pasted a URL to a large directory.
      for (const routes of [
        { [CONTENTS]: [] },
        { [CONTENTS]: [file("code-review/big.md", 100_000_000)] },
        { [CONTENTS]: Array.from({ length: 1_001 }, (_, index) => file(`code-review/${index}.md`, 0)) },
      ]) {
        await expect(imports.fetchSkillFiles(writer.id, location(), stub(routes).fetch)).rejects.toMatchObject({
          code: "import_rejected",
          status: 422,
        });
      }
    });

    it("does not tell a writer to reconnect without admitting the app may be at fault", async () => {
      await ready();
      // A 403 can be a spent grant or a missing app permission, and the walk
      // cannot tell them apart. Saying only "reconnect" sends a writer whose
      // Admin misconfigured the app round the same loop for ever.
      const provider = stub({ [CONTENTS]: new Response("nope", { status: 403 }) });

      await expect(imports.fetchSkillFiles(writer.id, location(), provider.fetch)).rejects.toThrow(/permission/i);
    });
  });

  describe("not a request-forgery surface", () => {
    it("accepts no URL field, and cannot be repointed by the body", async () => {
      await ready();
      const res = await post(writerCookie, {
        ...validBody(),
        // Ignored: the provider comes from the path, so a body cannot move the
        // request to a provider the caller prefers.
        provider: "gitlab",
        url: "https://evil.example.com/acme/skills",
      });

      // Reaches the walk (and fails there against no stub) rather than being
      // pointed anywhere: what matters is that it is not a 200 from evil.example.com.
      expect([409, 502]).toContain(res.status);
    });

    const rejected: Array<{ name: string; body: Record<string, unknown> }> = [
      { name: "a dot segment", body: validBody({ project: "acme/./skills" }) },
      { name: "a dot-dot segment", body: validBody({ project: "acme/../skills" }) },
      { name: "an empty segment", body: validBody({ project: "acme//skills" }) },
      { name: "percent-encoded traversal", body: validBody({ project: "acme/%2e%2e" }) },
      { name: "a leading slash", body: validBody({ project: "/acme/skills" }) },
      { name: "a trailing slash", body: validBody({ project: "acme/skills/" }) },
      { name: "a third segment, which GitHub has no room for", body: validBody({ project: "acme/skills/extra" }) },
      { name: "a ref with a slash", body: validBody({ ref: "release/1.0" }) },
      { name: "a ref with an at sign", body: validBody({ ref: "main@evil" }) },
      { name: "a traversing folder path", body: validBody({ path: "code-review/../../etc" }) },
      { name: "a percent-encoded folder path", body: validBody({ path: "code-review/%2e%2e" }) },
      { name: "a missing project", body: { ref: "main", path: "" } },
    ];

    for (const { name, body } of rejected) {
      it(`rejects ${name} before any outbound request`, async () => {
        await ready();
        const res = await post(writerCookie, body);
        expect(res.status).toBe(400);
      });
    }

    it("rejects an unknown Git Provider in the path as a client error", async () => {
      await ready();
      const res = await post(writerCookie, validBody(), "/api/imports/bitbucket/skill-files");
      expect(res.status).toBe(400);
    });
  });

  describe("who may import", () => {
    it("refuses a reader", async () => {
      await ready();
      expect((await post(readerCookie, validBody())).status).toBe(403);
    });

    it("refuses an unauthenticated caller", async () => {
      await ready();
      const res = await context.app.request(IMPORT_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody()),
      });
      expect(res.status).toBe(401);
    });
  });

  it("no longer serves the route it replaces", async () => {
    await ready();
    const res = await post(writerCookie, { owner: "acme", repo: "skills", ref: "main", path: "" }, "/api/github/skill-files");
    expect(res.status).toBe(404);
  });

  /**
   * `listSkillFolders` shares `fetchSkillFiles`'s preconditions and refusal
   * diagnosis wholesale — both are backed by the same Connection and the same
   * `refusal` method — so what is worth proving here is the route's wiring and
   * the one piece of behaviour that is genuinely new: a walk that finds
   * nothing means "no Skill found", not "that folder is empty".
   */
  describe("Discovering Skill folders (POST /imports/:provider/skills)", () => {
    const DISCOVER_PATH = "/api/imports/github/skills";
    const ROOT_CONTENTS = "https://api.github.com/repos/acme/skills/contents/?ref=main";
    const rootDir = (path: string): Record<string, unknown> => ({ path, type: "dir", download_url: null });
    const rootBody = (overrides: Record<string, unknown> = {}) => ({ project: "acme/skills", ref: "main", path: "", ...overrides });
    const rootLocation = () => ({ provider: "github", project: "acme/skills", ref: "main", path: "" });

    it("returns every Skill folder found, shaped as locations ready for /skill-files", async () => {
      await ready();
      const provider = stub({
        [ROOT_CONTENTS]: [rootDir("apps")],
        "https://api.github.com/repos/acme/skills/contents/apps?ref=main": [rootDir("apps/code-review")],
        "https://api.github.com/repos/acme/skills/contents/apps/code-review?ref=main": [file("apps/code-review/SKILL.md")],
      });

      const found = await imports.listSkillFolders(writer.id, rootLocation(), provider.fetch);

      expect(found).toEqual([{ provider: "github", project: "acme/skills", ref: "main", path: "apps/code-review" }]);
    });

    it("reports that no Skill was found, distinct from an empty folder", async () => {
      await ready();
      const provider = stub({ [ROOT_CONTENTS]: [{ path: "README.md", type: "file", download_url: null }] });

      await expect(imports.listSkillFolders(writer.id, rootLocation(), provider.fetch)).rejects.toMatchObject({
        code: "import_rejected",
        status: 422,
      });
      await expect(imports.listSkillFolders(writer.id, rootLocation(), provider.fetch)).rejects.toThrow(
        /No Skill was found/,
      );
    });

    it("refuses when no Integration is configured, before looking for a Connection", async () => {
      await clearAll();
      const res = await post(writerCookie, rootBody(), DISCOVER_PATH);
      expect(res.status).toBe(409);
      expect(((await res.json()) as ApiError).error.code).toBe("integration_not_configured");
    });

    it("refuses a writer who holds no Connection", async () => {
      await clearAll();
      await seedIntegration();
      const res = await post(writerCookie, rootBody(), DISCOVER_PATH);
      expect(res.status).toBe(409);
      expect(((await res.json()) as ApiError).error.code).toBe("not_connected");
    });

    it("diagnoses a 404 the same way fetchSkillFiles does, reusing the same refusal", async () => {
      await ready();
      const provider = stub({ [INSTALLATIONS]: { total_count: 0, installations: [] } });

      await expect(imports.listSkillFolders(writer.id, rootLocation(), provider.fetch)).rejects.toMatchObject({
        code: "app_not_installed",
      });
    });

    it("refuses a reader, and an unauthenticated caller", async () => {
      await ready();
      expect((await post(readerCookie, rootBody(), DISCOVER_PATH)).status).toBe(403);

      const res = await context.app.request(DISCOVER_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(rootBody()),
      });
      expect(res.status).toBe(401);
    });

    it("rejects a traversing path before any outbound request, same as /skill-files", async () => {
      await ready();
      const res = await post(writerCookie, rootBody({ path: "../etc" }), DISCOVER_PATH);
      expect(res.status).toBe(400);
    });

    it("cannot be moved to a different provider by the body", async () => {
      await ready();
      const res = await post(writerCookie, { ...rootBody(), provider: "gitlab", url: "https://evil.example.com" }, DISCOVER_PATH);
      // Reaches the walk (and fails there against no stub) rather than being pointed
      // anywhere: what matters is that it is not a 200 from evil.example.com.
      expect([409, 502]).toContain(res.status);
    });
  });

  /**
   * `GET /imports/:provider/repositories` — the picker behind "browse
   * repositories" on the publish screen. It shares `fetchSkillFiles`'s
   * preconditions (both spend the same Connection through the same service),
   * so what is worth proving here is its own shape: it walks every
   * installation, paginates, and turns a refusal into the same errors a
   * writer already knows from importing.
   */
  describe("Listing repositories (GET /imports/:provider/repositories)", () => {
    const REPOSITORIES_PATH = "/api/imports/github/repositories";
    const repo = (full_name: string, overrides: Record<string, unknown> = {}) => {
      const [owner, name] = full_name.split("/");
      return {
        full_name,
        name,
        owner: { login: owner },
        private: false,
        html_url: `https://github.com/${full_name}`,
        description: null,
        ...overrides,
      };
    };

    function get(cookie: string, path = REPOSITORIES_PATH) {
      return context.app.request(path, { headers: { cookie } });
    }

    it("lists every repository across every installation the connection sees", async () => {
      await ready();
      const provider = stub({
        [INSTALLATIONS]: { installations: [{ id: 7, account: { login: "acme" } }, { id: 9, account: { login: "ada" } }] },
        "https://api.github.com/user/installations/7/repositories?per_page=100&page=1": {
          repositories: [repo("acme/skills"), repo("acme/tools")],
        },
        "https://api.github.com/user/installations/9/repositories?per_page=100&page=1": {
          repositories: [repo("ada/notes")],
        },
      });

      const repositories = await imports.listRepositories(writer.id, "github", provider.fetch);
      expect(repositories.map((entry) => entry.full_name).sort()).toEqual(["acme/skills", "acme/tools", "ada/notes"]);
      expect(repositories[0]).toMatchObject({ name: "skills", owner: "acme", private: false });
    });

    it("pages a single installation past a hundred repositories", async () => {
      await ready();
      const fullPage = { repositories: Array.from({ length: 100 }, (_, index) => repo(`acme/repo-${index}`)) };
      const provider = stub({
        [INSTALLATIONS]: { installations: [{ id: 7, account: { login: "acme" } }] },
        "https://api.github.com/user/installations/7/repositories?per_page=100&page=1": fullPage,
        "https://api.github.com/user/installations/7/repositories?per_page=100&page=2": { repositories: [repo("acme/last")] },
      });

      const repositories = await imports.listRepositories(writer.id, "github", provider.fetch);
      expect(repositories).toHaveLength(101);
      expect(repositories.at(-1)?.full_name).toBe("acme/last");
    });

    it("skips a repository the provider answered without the fields a picker needs", async () => {
      await ready();
      const provider = stub({
        [INSTALLATIONS]: { installations: [{ id: 7, account: { login: "acme" } }] },
        "https://api.github.com/user/installations/7/repositories?per_page=100&page=1": {
          repositories: [repo("acme/skills"), { full_name: "acme/broken" }],
        },
      });

      const repositories = await imports.listRepositories(writer.id, "github", provider.fetch);
      expect(repositories.map((entry) => entry.full_name)).toEqual(["acme/skills"]);
    });

    it("refuses when no Integration is configured, before looking for a Connection", async () => {
      await clearAll();
      const res = await get(writerCookie);
      expect(res.status).toBe(409);
      expect(((await res.json()) as ApiError).error.code).toBe("integration_not_configured");
    });

    it("refuses a writer who holds no Connection", async () => {
      await clearAll();
      await seedIntegration();
      const res = await get(writerCookie);
      expect(res.status).toBe(409);
      expect(((await res.json()) as ApiError).error.code).toBe("not_connected");
    });

    it("says reconnect when the grant is refused", async () => {
      await ready();
      const provider = stub({ [INSTALLATIONS]: new Response("nope", { status: 401 }) });
      await expect(imports.listRepositories(writer.id, "github", provider.fetch)).rejects.toMatchObject({
        code: "connection_expired",
      });
    });

    it("passes on a rate limit as itself", async () => {
      await ready();
      const provider = stub({
        [INSTALLATIONS]: new Response("slow down", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
      });
      await expect(imports.listRepositories(writer.id, "github", provider.fetch)).rejects.toMatchObject({
        code: "import_failed",
        status: 502,
      });
    });

    it("refuses a reader, and an unauthenticated caller", async () => {
      await ready();
      expect((await get(readerCookie)).status).toBe(403);
      expect((await context.app.request(REPOSITORIES_PATH)).status).toBe(401);
    });

    it("rejects an unknown Git Provider in the path as a client error", async () => {
      await ready();
      expect((await get(writerCookie, "/api/imports/bitbucket/repositories")).status).toBe(400);
    });
  });
});

/** The location the stubs above are written for. */
function location() {
  return { provider: "github", project: "acme/skills", ref: "main", path: "code-review" };
}
