import { sql } from "drizzle-orm";
import { text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { appTable } from "../schemaFactory.js";
import { integrations } from "./integration";
import { users } from "./user";

/**
 * A writer's own grant of repository access to the Registry, made deliberately
 * and separately from signing in (ADR-0024). Its existence *is* the consent;
 * nothing else records it.
 *
 * Deliberately **not** an `accounts` row. Better Auth's `accounts` table models
 * identities, and a Connection is not one — nobody signs in by connecting, the
 * connected account need not be the account the writer signs in with, and the
 * Permitted Organisation gate does not run on it. Storing a third-party API
 * credential in the authentication table is the exact conflation ADR-0024
 * exists to undo.
 */
export const connections = appTable(
  "connections",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The Git Provider this grant is for, denormalized from `integrations`:
    // more than one Integration can exist per provider (ADR-0025), so this is
    // a plain string rather than a foreign key — `integration_id` below is the
    // real reference and is what makes "you cannot connect through an app this
    // Registry has not registered" a database invariant.
    provider: text("provider").notNull(),
    // Which Integration (app) this grant was issued through — a writer picks
    // one when more than one exists for the provider (ADR-0025). RESTRICT
    // rather than CASCADE on purpose: removing an Integration that writers
    // still hold Connections against must fail loudly, not silently drop
    // their credentials.
    integration_id: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "restrict" }),
    // The provider's own id for the connected account, which survives a rename
    // where the login does not.
    external_account_id: text("external_account_id").notNull(),
    // Shown in the interface so a writer can tell which account an Import runs
    // as — the connected account need not be the one they sign in with.
    external_account_login: text("external_account_login").notNull(),
    // Ciphertext, not a token: AES-256-GCM under the signing secret. Encryption
    // here defends a leaked backup and not a compromised host, because
    // `integrations.client_secret` sits in plaintext in the same database
    // (ADR-0015, ADR-0024).
    access_token: text("access_token").notNull(),
    // Ciphertext, as above. Null when the provider issued none, which is what a
    // GitHub App with token expiry switched off does — ADR-0024 keeps expiry on,
    // but an operator can turn it off on their own app and connecting must not
    // fail because of it.
    refresh_token: text("refresh_token"),
    // Null means the access token does not expire. Not a default: "unknown" and
    // "never" would otherwise be indistinguishable.
    expires_at: timestamp("expires_at", { withTimezone: true }),
    refresh_token_expires_at: timestamp("refresh_token_expires_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // One Connection per writer per provider. Reconnecting replaces rather than
    // accumulating, so "which account does this import use?" never needs asking.
    userProvider: unique("connections_user_id_provider_key").on(table.user_id, table.provider),
  }),
);

export type ConnectionRow = typeof connections.$inferSelect;
export type NewConnectionRow = typeof connections.$inferInsert;
