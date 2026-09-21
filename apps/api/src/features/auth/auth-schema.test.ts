import { describe, expect, it } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import { createAuth } from "./instance.js";
import { createDatabase } from "../../db/client.js";
import { createLogger } from "../../lib/logger.js";
import {
  accounts,
  rateLimits,
  sessions,
  users,
  verifications,
  type IdentityProviderRow,
} from "../../db/schemas/index.js";
import { deriveKeys } from "../../lib/secrets.js";

/** The Drizzle tables Better Auth is pointed at, by the model name it uses. */
const TABLES: Record<string, Parameters<typeof getTableColumns>[0]> = {
  users,
  sessions,
  accounts,
  verifications,
  // Only a model at all because rate limiting counts in Postgres rather than
  // in process memory (ISSUE-7) — Better Auth adds it to its own table list
  // when `rateLimit.storage` is "database", which is exactly the kind of
  // silently-added model this test exists to catch.
  rate_limits: rateLimits,
};

// Never connected to. postgres.js does not dial until a query runs, and
// resolving Better Auth's context only reads configuration — which is the
// whole point of this file: it checks the schema without needing a database,
// so it runs everywhere and fast.
const UNUSED_DATABASE_URL = "postgres://unused:unused@127.0.0.1:1/unused";
const SECRET = "test-only-secret-with-enough-entropy-to-be-quiet";

/**
 * Seam 0 — configuration, before any request or query.
 *
 * Better Auth reads and writes its own tables through the field map in
 * `auth/instance.ts`. A field it expects that maps to a column we never
 * declared does not fail loudly: the adapter selects nothing for it and the
 * value arrives `undefined`, so the failure surfaces far away as a login being
 * refused for a User who plainly exists.
 *
 * That is not hypothetical. `accounts.issuer` was missed exactly this way, and
 * because sign-in matched a password on provider id, issuer, and account id
 * together, every credential was invisible and every login was refused as
 * "user not found". This test is the check that would have caught it at the
 * schema rather than in a browser.
 *
 * Better Auth 1.7.3 then reverted `issuer` — accounts are keyed on provider id
 * and account id again — and the column outlived it as a `NOT NULL` nothing
 * wrote, which refused every insert instead. Better Auth notices that one
 * itself, but only logs it while resolving the context and throws at the
 * insert, so the first thing to fail is a request in production. The second
 * test below is what turns it into a failing build.
 */
describe("Better Auth's model and the schema agree", () => {
  it("maps every field Better Auth expects onto a column that exists", async () => {
    const { db } = createDatabase(UNUSED_DATABASE_URL);
    const auth = createAuth(
      { db, secret: SECRET, publicUrl: "http://localhost", logger: createLogger("silent"), keys: deriveKeys(SECRET) },
      [],
    );
    const context = await auth.$context;

    const missing: string[] = [];
    for (const table of Object.values(context.tables)) {
      const drizzleTable = TABLES[table.modelName];
      if (!drizzleTable) {
        missing.push(`${table.modelName} (no Drizzle table by that name)`);
        continue;
      }

      const columns = getTableColumns(drizzleTable);
      for (const [field, attributes] of Object.entries(table.fields)) {
        const key = attributes.fieldName ?? field;
        if (!(key in columns)) missing.push(`${table.modelName}.${key} (for field "${field}")`);
      }
    }

    expect(missing).toEqual([]);
  });

  it("declares no required column that Better Auth never writes", async () => {
    const { db } = createDatabase(UNUSED_DATABASE_URL);
    const auth = createAuth(
      { db, secret: SECRET, publicUrl: "http://localhost", logger: createLogger("silent"), keys: deriveKeys(SECRET) },
      [],
    );
    const context = await auth.$context;

    // The opposite direction to the test above, and the one that broke when
    // Better Auth 1.7.3 dropped `issuer`: a column Better Auth has no field
    // for is one it never supplies a value for, so declaring it `NOT NULL`
    // with no default makes every insert into that table fail. Better Auth
    // logs this during context resolution rather than throwing, which is why
    // asserting on it here is worth the lines.
    const unwritable: string[] = [];
    for (const table of Object.values(context.tables)) {
      const drizzleTable = TABLES[table.modelName];
      if (!drizzleTable) continue;

      const written = new Set(
        Object.entries(table.fields).map(([field, attributes]) => attributes.fieldName ?? field),
      );
      for (const [name, column] of Object.entries(getTableColumns(drizzleTable))) {
        if (written.has(name) || !column.notNull || column.hasDefault) continue;
        unwritable.push(`${table.modelName}.${name}`);
      }
    }

    expect(unwritable).toEqual([]);
  });

  it("points every model at a table this schema actually declares", async () => {
    const { db } = createDatabase(UNUSED_DATABASE_URL);
    const auth = createAuth(
      { db, secret: SECRET, publicUrl: "http://localhost", logger: createLogger("silent"), keys: deriveKeys(SECRET) },
      [],
    );
    const context = await auth.$context;

    // Guards the other direction: a model renamed in a future upgrade would
    // otherwise silently resolve to nothing.
    const models = Object.values(context.tables).map((table) => table.modelName).sort();
    expect(models).toEqual(["accounts", "rate_limits", "sessions", "users", "verifications"]);
  });
});

/**
 * Seam 0, second half — the account-linking settings, which decide whether an
 * external login may attach to a User that already exists.
 *
 * These fail the same silent way the field map did. Better Auth's defaults
 * refuse a link when the *local* `email_verified` is false, and this Registry
 * never verifies an address itself — the column defaults to false on every User
 * `/setup` or an Admin creates. The symptom is a login refused as "account not
 * linked" for a User who plainly exists, which is ADR-0015's central promise
 * broken with nothing in the schema to show it.
 */
describe("account linking admits an existing User", () => {
  /** An enabled Provider row, with only the fields `trustedProvidersFor` reads. */
  function provider(kind: IdentityProviderRow["kind"], permitted: string[]): IdentityProviderRow {
    return {
      id: `id-${kind}`,
      kind,
      display_name: kind,
      client_id: "client-id",
      client_secret: "client-secret",
      permitted_organisations: permitted,
      enabled: true,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  async function contextFor(providers: IdentityProviderRow[] = []) {
    const { db } = createDatabase(UNUSED_DATABASE_URL);
    const auth = createAuth(
      { db, secret: SECRET, publicUrl: "http://localhost", logger: createLogger("silent"), keys: deriveKeys(SECRET) },
      providers,
    );
    return auth.$context;
  }

  it("does not require a locally-verified address, which this Registry never establishes", async () => {
    const context = await contextFor();
    expect(context.options.account?.accountLinking?.requireLocalEmailVerified).toBe(false);
    expect(context.options.account?.accountLinking?.enabled).toBe(true);
  });

  it("trusts a configured Google Provider, which asserts email_verified only for addresses it verified", async () => {
    const context = await contextFor([provider("google", ["example.com"])]);
    expect(context.trustedProviders).toEqual(["google"]);
  });

  it("trusts a Microsoft Provider pinned to exactly one tenant, whose addresses that tenant's admin provisions", async () => {
    const context = await contextFor([provider("microsoft", ["11111111-2222-3333-4444-555555555555"])]);
    expect(context.trustedProviders).toEqual(["microsoft"]);
  });

  // The nOAuth bug: Entra's `email` is a mutable, unverified attribute, so any
  // tenant administrator could set it to a Superadmin's address and have the
  // login attach to that account (ISSUE-2). Only a single pinned tenant —
  // endpoint and `tid` both — makes that claim worth anything.
  it("does not trust an ungated Microsoft Provider, whose email claim any tenant can set", async () => {
    const context = await contextFor([provider("microsoft", [])]);
    expect(context.trustedProviders).not.toContain("microsoft");
  });

  it("does not trust a multi-tenant Microsoft Provider either", async () => {
    const context = await contextFor([provider("microsoft", ["tenant-a", "tenant-b"])]);
    expect(context.trustedProviders).not.toContain("microsoft");
  });

  it("does not trust GitHub, whose address may be one GitHub never challenged (ADR-0018)", async () => {
    const context = await contextFor([provider("github", ["acme"])]);
    expect(context.trustedProviders).not.toContain("github");
  });
});
