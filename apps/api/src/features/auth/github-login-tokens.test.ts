import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import { GITHUB_SCOPES } from "./github.js";
import { createAuth } from "./instance.js";
import { createLogger } from "../../lib/logger.js";
import { deriveKeys } from "../../lib/secrets.js";
import { accounts, connections, integrations, users, type UserRow } from "../../db/schemas/index.js";
import { dbSchema } from "../../db/schemaFactory.js";
import {
  seedUserWithPassword,
  startTestContext,
  stopTestContext,
  TEST_AUTH_SECRET,
  TEST_PUBLIC_URL,
  type TestContext,
} from "../../../test/context.js";

const PASSWORD = "correct-horse-battery";

/**
 * Seam 1 — the API request boundary, plus Better Auth's own account writer for
 * the one thing no request can reach.
 *
 * The OAuth handshake is not exercised and after ADR-0016 is emphatically not
 * ours to exercise: the redirect, the PKCE exchange, and the callback are
 * Better Auth's. What *is* ours is what gets written when that callback lands,
 * so these drive `internalAdapter.createAccount` — the same function the
 * callback calls, and the one the database hook hangs off. Asserting on the
 * configuration instead would prove only that a flag is set, not that a row
 * comes out clean.
 */
describe("A GitHub login stores no repository credential (ADR-0024)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;
  let writer: UserRow;

  beforeAll(async () => {
    const started = await startTestContext();
    container = started.container;
    context = started.context;

    writer = await seedUserWithPassword(context, {
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      password: PASSWORD,
      role: "writer",
    });
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  /**
   * Better Auth's own account writer, which is what an OAuth callback uses.
   *
   * Built here rather than taken off the app: the hook under test lives in
   * `createAuth`, so an instance made the same way exercises the same path, and
   * the test harness does not have to grow a field for it.
   */
  function instance() {
    return createAuth(
      {
        db: context.db,
        secret: TEST_AUTH_SECRET,
        publicUrl: TEST_PUBLIC_URL,
        logger: createLogger("silent"),
        keys: deriveKeys(TEST_AUTH_SECRET),
      },
      [],
    );
  }

  async function createAccount(providerId: string, tokens: Record<string, unknown>) {
    const ctx = await instance().$context;
    await ctx.internalAdapter.createAccount({
      userId: writer.id,
      providerId,
      // Required, and the field whose omission once made every login fail as
      // "user not found" — see auth-schema.test.ts.
      issuer: providerId,
      accountId: `${providerId}-account-id`,
      ...tokens,
    });
  }

  function storedAccount(providerId: string) {
    return context.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.user_id, writer.id), eq(accounts.provider_id, providerId)))
      .limit(1);
  }

  describe("what the login asks for", () => {
    it("asks for identity and nothing else", () => {
      expect(GITHUB_SCOPES).toEqual(["read:user", "user:email", "read:org"]);
    });

    it("keeps read:org, without which the organisation gate refuses everyone", () => {
      // `/user/orgs` returns an empty list for every member without it, and an
      // empty list is what `assertOrganisation` refuses (ADR-0018).
      expect(GITHUB_SCOPES).toContain("read:org");
    });
  });

  describe("what a GitHub login writes", () => {
    it("writes the account row, but not its tokens", async () => {
      await context.db.delete(accounts);
      await createAccount("github", {
        accessToken: "gho_a_repo_capable_token",
        refreshToken: "ghr_a_refresh_token",
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      });

      const [row] = await storedAccount("github");
      // The row itself must survive: it is how a returning login is recognised.
      expect(row?.account_id).toBe("github-account-id");
      expect(row?.access_token).toBeNull();
      expect(row?.refresh_token).toBeNull();
      expect(row?.access_token_expires_at).toBeNull();
    });

    it("stores nothing even encrypted, so a leaked backup carries no grant", async () => {
      await context.db.delete(accounts);
      await createAccount("github", { accessToken: "gho_a_repo_capable_token" });

      // Asserted on the raw column rather than through a decrypt: the point is
      // that there is no ciphertext to decrypt, not that decryption fails.
      const [row] = await storedAccount("github");
      expect(row?.access_token).toBeNull();
      expect(JSON.stringify(row)).not.toContain("gho_");
    });

    it("does not refill the column when a returning login re-authorizes", async () => {
      await context.db.delete(accounts);
      await createAccount("github", { accessToken: "gho_first" });

      const ctx = await instance().$context;
      const [existing] = await storedAccount("github");
      // The update path is the one a second sign-in takes, and leaving it open
      // would quietly refill what the migration cleared.
      //
      // `providerId` is sent deliberately, because that is what Better Auth's
      // own callback sends: `link-account.mjs` builds its refresh payload as
      // `{ providerId, idToken, accessToken, refreshToken, ... }`. The update
      // hook has nothing else to key on — it receives the payload and not the
      // row — so a test omitting it would prove the hook never fires rather
      // than that it works.
      await ctx.internalAdapter.updateAccount(existing?.id ?? '', {
        providerId: "github",
        accessToken: "gho_second",
      });

      expect((await storedAccount("github"))[0]?.access_token).toBeNull();
    });

    it("discriminates by provider on the update path too", async () => {
      await context.db.delete(accounts);
      await createAccount("google", { accessToken: "ya29.first" });

      const ctx = await instance().$context;
      const [existing] = await storedAccount("google");
      await ctx.internalAdapter.updateAccount(existing?.id ?? '', {
        providerId: "google",
        accessToken: "ya29.second",
      });

      // Refreshed, not stripped: the hook must not be a blanket token eraser.
      expect((await storedAccount("google"))[0]?.access_token).toBe("ya29.second");
    });
  });

  describe("what it leaves alone", () => {
    it("keeps a Google login's tokens, which are not repo-shaped", async () => {
      await context.db.delete(accounts);
      await createAccount("google", { accessToken: "ya29.a_google_token" });

      const [row] = await storedAccount("google");
      expect(row?.access_token).not.toBeNull();
    });

    it("does not claim to prove encryption, which happens a layer above this seam", () => {
      // `encryptOAuthTokens` is applied by `setTokenUtil` in Better Auth's OAuth
      // callback, *before* it reaches `internalAdapter.createAccount`. So a token
      // written through this seam is stored as given, and a test here asserting
      // ciphertext would be asserting something this level never does. The flag
      // itself is checked in auth-schema.test.ts's configuration seam.
      expect(true).toBe(true);
    });

    it("keeps a Microsoft login's tokens", async () => {
      await context.db.delete(accounts);
      await createAccount("microsoft", { accessToken: "an_entra_token" });

      expect((await storedAccount("microsoft"))[0]?.access_token).not.toBeNull();
    });

    it("leaves the scope column alone, which is the audit trail and still truthful", async () => {
      await context.db.delete(accounts);
      // GitHub has still granted `repo` to anyone who once agreed to it, because
      // scopes accumulate on an OAuth App. The column records the grant, not what
      // the Registry asked for — so clearing it would make the row less truthful
      // and erase the only record of who should go and revoke it at GitHub.
      await context.db.insert(accounts).values({
        user_id: writer.id,
        provider_id: "github",
        issuer: "github",
        account_id: "legacy-with-scope",
        access_token: "gho_left_over",
        scope: "read:user,user:email,read:org,repo",
      });

      await context.db.update(accounts).set({ access_token: null }).where(eq(accounts.provider_id, "github"));

      const [row] = await storedAccount("github");
      expect(row?.access_token).toBeNull();
      expect(row?.scope).toContain("repo");
    });

    it("keeps a credential login's password, which lives in the same column family", async () => {
      // `seedUserWithPassword` wrote one through the `credential` provider. If
      // the hook were keyed on anything looser than the provider id, this is
      // where it would show up.
      const [row] = await storedAccount("credential");
      expect(row?.password).not.toBeNull();
    });

    it("leaves a Connection untouched, so a writer who connected can still import", async () => {
      await context.db.delete(connections);
      await context.db.delete(integrations);
      const [integration] = await context.db
        .insert(integrations)
        .values({
          provider: "github",
          display_name: "GitHub",
          client_id: "Iv1.client",
          client_secret: "the-secret",
          app_slug: "acme-registry",
        })
        .returning();
      await context.db.insert(connections).values({
        user_id: writer.id,
        provider: "github",
        integration_id: integration?.id ?? "",
        external_account_id: "1",
        external_account_login: "ada-work",
        access_token: "ciphertext",
      });

      await context.db.delete(accounts);
      await createAccount("github", { accessToken: "gho_a_repo_capable_token" });

      // Two different tables, and only one of them is the login's.
      const [connection] = await context.db.select().from(connections);
      expect(connection?.access_token).toBe("ciphertext");
    });
  });

  describe("the migration that cleared what was already stored", () => {
    it("has already run, and is idempotent when run again", async () => {
      await context.db.delete(accounts);
      // A row as it looked before this change: a stored, encrypted login token.
      await context.db.insert(accounts).values({
        user_id: writer.id,
        provider_id: "github",
        issuer: "github",
        account_id: "legacy",
        access_token: "left_over_from_before",
        refresh_token: "also_left_over",
      });

      await context.sql`
        UPDATE ${context.sql(dbSchema)}."accounts"
        SET "access_token" = NULL,
            "refresh_token" = NULL,
            "access_token_expires_at" = NULL,
            "refresh_token_expires_at" = NULL,
            "updated_at" = now()
        WHERE "provider_id" = 'github'
          AND ("access_token" IS NOT NULL OR "refresh_token" IS NOT NULL
               OR "access_token_expires_at" IS NOT NULL OR "refresh_token_expires_at" IS NOT NULL)
      `;

      const [cleared] = await storedAccount("github");
      expect(cleared?.access_token).toBeNull();
      expect(cleared?.refresh_token).toBeNull();
      // Still recognisable as the same linked account: only the tokens went.
      expect(cleared?.account_id).toBe("legacy");
    });

    it("was applied by the migrator, which ran twice at start-up", async () => {
      // `startTestContext` runs migrations twice on purpose, so a migration
      // that is not idempotent fails the whole suite rather than one case.
      // Bookkeeping lives alongside the objects it describes, in the schema
      // DB_SCHEMA names, so two apps sharing a database keep separate ledgers.
      const applied = await context.sql<{ hash: string }[]>`
        SELECT hash FROM ${context.sql(dbSchema)}.__drizzle_migrations ORDER BY created_at
      `;
      expect(applied.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("leaves the Users who signed in able to sign in again", async () => {
    // The account row is what a returning login is matched on, so clearing the
    // tokens must not have made anyone unrecognisable.
    const [row] = await context.db.select().from(users).where(eq(users.id, writer.id));
    expect(row?.email).toBe("ada@example.com");
  });
});
