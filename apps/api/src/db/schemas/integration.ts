import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The Registry's registration with one Git Provider, holding the credential
 * pair a Connection is granted against (ADR-0024).
 *
 * An Integration is not an Identity Provider, and this is deliberately not a
 * column on `identity_providers`. GitHub is reached through two separate
 * registrations — an OAuth App for signing in, a GitHub App for Importing —
 * and the two share nothing but a vendor. A GitLab row can exist here with no
 * `identity_providers` row at all, and vice versa.
 *
 * A row's existence is the only switch. Importing from a Git Provider is
 * available for exactly those providers with a row here; there is no
 * Admin-level flag above it, because an operator who wants no repository
 * credentials in the database simply does not create one (ADR-0024).
 */
export const integrations = pgTable("integrations", {
  // The provider's own name, and the row's identity: `github`, `gitlab`. A
  // plain text primary key rather than an enum, so adding a provider is an
  // insert and not a migration (ADR-0024). The values it may take are the keys
  // of `GIT_PROVIDERS` in `@skill-registry/shared`, checked in the service —
  // Postgres constrains `connections.provider` against this column instead,
  // which is what makes "you cannot connect to a provider this Registry has
  // not registered" a database invariant.
  provider: text("provider").primaryKey(),
  display_name: text("display_name").notNull(),
  client_id: text("client_id").notNull(),
  // Stored as given, following listmonk and `identity_providers` (ADR-0015).
  // Written and never read back out over the wire — no response shape
  // includes it.
  client_secret: text("client_secret").notNull(),
  // The app's slug at the provider, used to build its installation URL
  // (`https://github.com/apps/{app_slug}/installations/new`). Null for a
  // provider with no installation step of its own — GitLab has none — which is
  // why this is nullable rather than required.
  app_slug: text("app_slug"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IntegrationRow = typeof integrations.$inferSelect;
export type NewIntegrationRow = typeof integrations.$inferInsert;
