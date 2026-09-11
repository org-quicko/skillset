import { describe, expect, it } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import { createAuth } from "./instance.js";
import { createDatabase } from "../../db/client.js";
import { createLogger } from "../../lib/logger.js";
import { accounts, sessions, users, verifications } from "../../db/schemas/index.js";

/** The Drizzle tables Better Auth is pointed at, by the model name it uses. */
const TABLES: Record<string, Parameters<typeof getTableColumns>[0]> = {
  users,
  sessions,
  accounts,
  verifications,
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
 * because sign-in matches a password on provider id, issuer, and account id
 * together, every credential was invisible and every login was refused as
 * "user not found". This test is the check that would have caught it at the
 * schema rather than in a browser.
 */
describe("Better Auth's model and the schema agree", () => {
  it("maps every field Better Auth expects onto a column that exists", async () => {
    const { db } = createDatabase(UNUSED_DATABASE_URL);
    const auth = createAuth({ db, secret: SECRET, publicUrl: "http://localhost", logger: createLogger("silent") }, []);
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

  it("points every model at a table this schema actually declares", async () => {
    const { db } = createDatabase(UNUSED_DATABASE_URL);
    const auth = createAuth({ db, secret: SECRET, publicUrl: "http://localhost", logger: createLogger("silent") }, []);
    const context = await auth.$context;

    // Guards the other direction: a model renamed in a future upgrade would
    // otherwise silently resolve to nothing.
    const models = Object.values(context.tables).map((table) => table.modelName).sort();
    expect(models).toEqual(["accounts", "sessions", "users", "verifications"]);
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
  async function contextFor() {
    const { db } = createDatabase(UNUSED_DATABASE_URL);
    const auth = createAuth({ db, secret: SECRET, publicUrl: "http://localhost", logger: createLogger("silent") }, []);
    return auth.$context;
  }

  it("does not require a locally-verified address, which this Registry never establishes", async () => {
    const context = await contextFor();
    expect(context.options.account?.accountLinking?.requireLocalEmailVerified).toBe(false);
    expect(context.options.account?.accountLinking?.enabled).toBe(true);
  });

  it("trusts Google and Microsoft, because Entra asserts no email_verified and would never link", async () => {
    const context = await contextFor();
    expect(context.trustedProviders).toEqual(["google", "microsoft"]);
  });

  it("does not trust GitHub, whose address may be one GitHub never challenged (ADR-0018)", async () => {
    const context = await contextFor();
    expect(context.trustedProviders).not.toContain("github");
  });
});
