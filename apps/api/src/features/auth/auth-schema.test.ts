import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { ColumnMetadata } from "kysely";
import { createAuth } from "./instance.js";
import { createDatabase, type Database } from "../../db/client.js";
import type { IdentityProviderRow } from "../../db/tables.js";
import { createLogger } from "../../lib/logger.js";
import { deriveKeys } from "../../lib/secrets.js";
import { startTestContext, stopTestContext, type TestContext } from "../../../test/context.js";

// Never connected to. pg's pool does not dial until a query runs, and
// resolving Better Auth's context only reads configuration, so the linking
// checks below need no database at all.
const UNUSED_DATABASE_URL = "postgres://unused:unused@127.0.0.1:1/unused";
const SECRET = "test-only-secret-with-enough-entropy-to-be-quiet";

function authContextFor(db: Database, providers: IdentityProviderRow[] = []) {
  const auth = createAuth(
    { db, secret: SECRET, publicUrl: "http://localhost", logger: createLogger("silent"), keys: deriveKeys(SECRET) },
    providers,
  );
  return auth.$context;
}

/**
 * Seam 0 — configuration, checked against the schema the migrations build.
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
 *
 * The columns are read by introspecting the migrated database, the schema
 * Better Auth actually runs against.
 */
describe("Better Auth's model and the schema agree", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;
  /** The migrated tables, by name, restricted to `DB_SCHEMA`. */
  let tables: Map<string, ColumnMetadata[]>;

  beforeAll(async () => {
    const started = await startTestContext();
    container = started.container;
    context = started.context;
    const introspected = await context.db.introspection.getTables();
    tables = new Map(
      introspected.filter((table) => table.schema === context.schema).map((table) => [table.name, table.columns]),
    );
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  /**
   * Better Auth's context for the migrated database, once its own schema check
   * has settled. Awaited rather than left running: closing the pool while that
   * check still holds a connection never resolves.
   */
  async function migratedAuthContext() {
    const auth = await authContextFor(context.db);
    await auth.checkSchema?.();
    return auth;
  }

  it("maps every field Better Auth expects onto a column that exists", async () => {
    const auth = await migratedAuthContext();

    const missing: string[] = [];
    for (const table of Object.values(auth.tables)) {
      const columns = tables.get(table.modelName);
      if (!columns) {
        missing.push(`${table.modelName} (no table by that name)`);
        continue;
      }

      const names = new Set(columns.map((column) => column.name));
      for (const [field, attributes] of Object.entries(table.fields)) {
        const key = attributes.fieldName ?? field;
        if (!names.has(key)) missing.push(`${table.modelName}.${key} (for field "${field}")`);
      }
    }

    expect(missing).toEqual([]);
  });

  it("declares no required column that Better Auth never writes", async () => {
    const auth = await migratedAuthContext();

    // The opposite direction to the test above, and the one that broke when
    // Better Auth 1.7.3 dropped `issuer`: a column Better Auth has no field
    // for is one it never supplies a value for, so declaring it `NOT NULL`
    // with no default makes every insert into that table fail. Better Auth
    // logs this during context resolution rather than throwing, which is why
    // asserting on it here is worth the lines.
    const unwritable: string[] = [];
    for (const table of Object.values(auth.tables)) {
      const columns = tables.get(table.modelName);
      if (!columns) continue;

      const written = new Set(
        Object.entries(table.fields).map(([field, attributes]) => attributes.fieldName ?? field),
      );
      for (const column of columns) {
        if (written.has(column.name) || column.isNullable || column.hasDefaultValue) continue;
        unwritable.push(`${table.modelName}.${column.name}`);
      }
    }

    expect(unwritable).toEqual([]);
  });

  it("points every model at a table this schema actually declares", async () => {
    const auth = await migratedAuthContext();

    // Guards the other direction: a model renamed in a future upgrade would
    // otherwise silently resolve to nothing.
    const models = Object.values(auth.tables).map((table) => table.modelName).sort();
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

  function contextFor(providers: IdentityProviderRow[] = []) {
    const { db } = createDatabase(UNUSED_DATABASE_URL, "public");
    return authContextFor(db, providers);
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
