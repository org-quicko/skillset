import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { symmetricEncrypt } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { accounts, identityProviders } from "../src/db/schemas/index.js";
import { GitHubImportService } from "../src/services/github-import.js";
import { createLogger } from "../src/logger.js";
import {
  seedUserWithPassword,
  signIn,
  startTestContext,
  stopTestContext,
  TEST_AUTH_SECRET,
  type TestContext,
} from "./setup.js";

interface ApiError {
  error: { code: string; message: string; field?: string };
}

const PASSWORD = "correct-horse-battery";
const IMPORT_PATH = "/api/github/skill-files";

/** A body that would succeed if everything else were in place. */
function validBody(overrides: Record<string, unknown> = {}) {
  return { owner: "acme", repo: "skills", ref: "main", path: "code-review", ...overrides };
}

/**
 * Seam 1 — the API request boundary, plus the import service driven directly
 * where a stubbed GitHub is the only way to reach a branch.
 *
 * What is deliberately not tested is a real GitHub round trip: that would test
 * GitHub. What is tested is everything this Registry is actually responsible
 * for — who may call the route, whose access it runs as, and the validation
 * that keeps a server-side fetch from being pointed somewhere it should not go
 * (ADR-0020).
 */
describe("Importing a Skill from a private GitHub repository (ADR-0020)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;
  let writerCookie: string;
  let writerId: string;
  let readerCookie: string;

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
    if (signUp.status !== 201) throw new Error(`Setup failed: ${signUp.status}`);

    const writer = await seedUserWithPassword(context, {
      first_name: "Wendy",
      last_name: "Writer",
      email: "writer@example.com",
      password: PASSWORD,
      role: "writer",
    });
    writerId = writer.id;
    writerCookie = await signIn(context, "writer@example.com", PASSWORD);

    await seedUserWithPassword(context, {
      first_name: "Rhea",
      last_name: "Reader",
      email: "reader@example.com",
      password: PASSWORD,
      role: "reader",
    });
    readerCookie = await signIn(context, "reader@example.com", PASSWORD);

    // An import only runs while GitHub is an enabled Identity Provider: the
    // stored tokens are a by-product of that login, so turning it off
    // withdraws them (ADR-0020). Every test below that expects an import to
    // get anywhere needs it on.
    await context.db.insert(identityProviders).values({
      kind: "github",
      display_name: "GitHub",
      client_id: "client-id",
      client_secret: "client-secret",
      permitted_organisations: ["acme"],
      enabled: true,
    });
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  async function post(body: unknown, cookie?: string): Promise<Response> {
    return context.app.request(IMPORT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  }

  describe("who may import", () => {
    it("refuses a visitor with no session", async () => {
      expect((await post(validBody())).status).toBe(401);
    });

    it("refuses a reader — importing exists to publish", async () => {
      expect((await post(validBody(), readerCookie)).status).toBe(403);
    });

    it("tells a writer with no linked GitHub account to sign in with GitHub", async () => {
      const res = await post(validBody(), writerCookie);
      expect(res.status).toBe(409);

      // Distinct from a 404 on purpose: nothing is wrong with the URL, and the
      // writer needs to be told the actual next step.
      const body = (await res.json()) as ApiError;
      expect(body.error.code).toBe("github_not_connected");
    });
  });

  describe("the request-forgery surface", () => {
    // Each of these is refused by the schema before any outbound request, which
    // is what makes the fixed-host guarantee hold (ADR-0020). They run as a
    // writer with no linked account, so a 400 also proves validation happens
    // before the credential lookup that would otherwise 409.
    const rejected: [string, Record<string, unknown>][] = [
      ["an owner containing a slash", { owner: "acme/evil" }],
      ["a repo containing a slash", { repo: "skills/../../evil" }],
      ["an owner using an @ to rewrite the URL's authority", { owner: "api.github.com@evil.example.com" }],
      ["an owner carrying a query string", { owner: "acme?x=y" }],
      ["an owner carrying a fragment", { owner: "acme#x" }],
      ["a ref containing a slash", { ref: "heads/main" }],
      ["a path that climbs out of the repository", { path: "skills/../../../etc" }],
      ["a path with a leading slash", { path: "/etc/passwd" }],
      ["a path with a trailing slash", { path: "code-review/" }],
      ["an empty owner", { owner: "" }],
    ];

    for (const [name, override] of rejected) {
      it(`rejects ${name}`, async () => {
        const res = await post(validBody(override), writerCookie);
        expect(res.status).toBe(400);
        expect(((await res.json()) as ApiError).error.code).toBe("validation_failed");
      });
    }

    it("accepts a dotted owner, which cannot escape the fixed host", async () => {
      // `evil.example.com` is a legal value here and deliberately so: it
      // becomes `api.github.com/repos/evil.example.com/...`, which is a
      // repository that does not exist rather than a request to another host.
      // The characters that *could* rewrite the URL — `/`, `@`, `?`, `#` — are
      // the ones excluded above.
      const res = await post(validBody({ owner: "evil.example.com" }), writerCookie);
      expect(res.status).toBe(409);
    });

    it("accepts the repository root, which is an empty path rather than a slash", async () => {
      // Not a 400: the empty path is legitimate and must not be caught by the
      // rules above. It gets as far as the credential lookup and stops there.
      const res = await post(validBody({ path: "" }), writerCookie);
      expect(res.status).toBe(409);
    });

    it("has no URL field to aim anywhere", async () => {
      const res = await post({ url: "https://evil.example.com/owner/repo" }, writerCookie);
      expect(res.status).toBe(400);
    });
  });

  describe("fetching, against a stubbed GitHub", () => {
    const service = () => new GitHubImportService(context.db, TEST_AUTH_SECRET, createLogger("silent"));

    /**
     * Links a GitHub account holding `token`, stored the way Better Auth
     * stores one: encrypted, because `encryptOAuthTokens` is on (ADR-0020).
     * Seeding the plaintext instead would test a row the Registry never
     * writes, and would pass whether or not the import decrypts at all.
     */
    async function linkGitHub(token: string): Promise<void> {
      await linkGitHubRaw(await symmetricEncrypt({ key: TEST_AUTH_SECRET, data: token }));
    }

    /** Writes the `access_token` column verbatim, encrypted or not. */
    async function linkGitHubRaw(stored: string): Promise<void> {
      await context.db
        .insert(accounts)
        .values({
          user_id: writerId,
          account_id: "github-12345",
          provider_id: "github",
          issuer: "https://github.com",
          access_token: stored,
        })
        .onConflictDoUpdate({
          target: [accounts.provider_id, accounts.issuer, accounts.account_id],
          set: { access_token: stored },
        });
    }

    /**
     * A `fetch` recording every URL and bearer token asked for, answering from
     * a fixture map. Passed to `fetchSkillFiles` rather than assigned over the
     * global: the walk itself lives in shared and is tested there, so what is
     * left to observe here is only which credential this service spends.
     */
    function stubGitHub(routes: Record<string, unknown>): { fetch: typeof fetch; urls: string[]; bearers: string[] } {
      const urls: string[] = [];
      const bearers: string[] = [];
      const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        urls.push(url);
        const authorization = new Headers(init?.headers).get("authorization");
        if (authorization) bearers.push(authorization.replace(/^Bearer /, ""));

        const body = routes[url];
        if (body === undefined) return new Response("not found", { status: 404 });
        if (body instanceof Response) return body;
        if (body instanceof Uint8Array) return new Response(body, { status: 200 });
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;
      return { fetch: fetchImpl, urls, bearers };
    }

    it("reads a folder as the calling writer, spending that writer's decrypted token", async () => {
      await linkGitHub("gho_writer_token");
      const stub = stubGitHub({
        "https://api.github.com/repos/acme/skills/contents/code-review?ref=main": [
          {
            path: "code-review/SKILL.md",
            type: "file",
            size: 12,
            download_url: "https://raw.githubusercontent.com/acme/skills/main/code-review/SKILL.md",
          },
        ],
        "https://raw.githubusercontent.com/acme/skills/main/code-review/SKILL.md": new TextEncoder().encode(
          "hello world!",
        ),
      });

      const files = await service().fetchSkillFiles(writerId, validBody() as never, stub.fetch);

      expect(files).toHaveLength(1);
      expect(files[0]?.path).toBe("SKILL.md");
      expect(new TextDecoder().decode(files[0]?.bytes)).toBe("hello world!");

      // The point of this test, and the reason it lives here rather than
      // beside the walk: the token GitHub is handed is the writer's own, not
      // the ciphertext the column holds. Asserted rather than assumed, since
      // sending the stored value verbatim fails only at GitHub, which no stub
      // would ever notice.
      expect(stub.bearers.length).toBeGreaterThan(0);
      expect(new Set(stub.bearers)).toEqual(new Set(["gho_writer_token"]));
    });

    it("still reads a token stored before encryption was turned on", async () => {
      // Better Auth returns a value that does not look encrypted untouched, so
      // enabling `encryptOAuthTokens` does not strand rows already written
      // (ADR-0020). The import inherits that, and this pins it.
      await linkGitHubRaw("gho_plaintext_token");
      const stub = stubGitHub({
        "https://api.github.com/repos/acme/skills/contents/code-review?ref=main": [],
      });

      await expect(service().fetchSkillFiles(writerId, validBody() as never, stub.fetch)).rejects.toThrow(/empty/);
      expect(stub.bearers).toEqual(["gho_plaintext_token"]);
    });

    it("reports the walk's refusal as a github_import_failed the writer can act on", async () => {
      // How a reason crosses out of shared: the walk throws
      // `rate_limited`, and this service turns it into the sentence an
      // authenticated writer needs — not "sign in again", which fixes nothing.
      await linkGitHub("gho_writer_token");
      const stub = stubGitHub({
        "https://api.github.com/repos/acme/skills/contents/code-review?ref=main": new Response("rate limited", {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
        }),
      });

      await expect(service().fetchSkillFiles(writerId, validBody() as never, stub.fetch)).rejects.toThrow(
        /rate-limited/,
      );
    });

    describe("when github sign-in is not enabled", () => {
      /**
       * The folder every test here would import if the token were sent, so a
       * refusal cannot be mistaken for a repository that was not there.
       */
      const READABLE_FOLDER = {
        "https://api.github.com/repos/acme/skills/contents/code-review?ref=main": [
          {
            path: "code-review/SKILL.md",
            type: "file",
            size: 12,
            download_url: "https://raw.githubusercontent.com/acme/skills/main/code-review/SKILL.md",
          },
        ],
        "https://raw.githubusercontent.com/acme/skills/main/code-review/SKILL.md": new TextEncoder().encode(
          "hello world!",
        ),
      };

      afterEach(async () => {
        await context.db
          .update(identityProviders)
          .set({ enabled: true })
          .where(eq(identityProviders.kind, "github"));
      });

      it("refuses the import, and spends no token, while the Provider is disabled", async () => {
        await linkGitHub("gho_writer_token");
        await context.db
          .update(identityProviders)
          .set({ enabled: false })
          .where(eq(identityProviders.kind, "github"));
        const stub = stubGitHub(READABLE_FOLDER);

        await expect(service().fetchSkillFiles(writerId, validBody() as never, stub.fetch)).rejects.toThrow(
          /GitHub sign-in is turned off/,
        );

        // The point of the switch: not that the import fails, but that the
        // writer's stored token never leaves the Registry. A refusal after the
        // fetch would read the same from the outside and would not be this.
        expect(stub.urls).toEqual([]);
        expect(stub.bearers).toEqual([]);
      });

      it("refuses the import when GitHub was never configured as a Provider", async () => {
        await linkGitHub("gho_writer_token");
        await context.db.delete(identityProviders).where(eq(identityProviders.kind, "github"));
        const stub = stubGitHub(READABLE_FOLDER);

        await expect(service().fetchSkillFiles(writerId, validBody() as never, stub.fetch)).rejects.toThrow(
          /GitHub sign-in is turned off/,
        );
        expect(stub.urls).toEqual([]);

        await context.db.insert(identityProviders).values({
          kind: "github",
          display_name: "GitHub",
          client_id: "client-id",
          client_secret: "client-secret",
          permitted_organisations: ["acme"],
          enabled: true,
        });
      });

      it("tells the browser which refusal it was, so it can fall back anonymously", async () => {
        await linkGitHub("gho_writer_token");
        await context.db
          .update(identityProviders)
          .set({ enabled: false })
          .where(eq(identityProviders.kind, "github"));

        const res = await post(validBody(), writerCookie);
        expect(res.status).toBe(409);

        // The code the publish screen branches on to retry the fetch
        // anonymously. Distinct from `github_not_connected` because the remedy
        // is an Admin's, not the writer's.
        expect(((await res.json()) as ApiError).error.code).toBe("github_login_disabled");
      });
    });
  });
});
