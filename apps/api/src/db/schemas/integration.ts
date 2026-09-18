import { sql } from "drizzle-orm";
import { text, timestamp, uuid } from "drizzle-orm/pg-core";
import { appTable } from "../schemaFactory.js";

/**
 * The Registry's registration with a Git Provider, holding the credential
 * pair a Connection is granted against (ADR-0024, ADR-0025).
 *
 * An Integration is not an Identity Provider, and this is deliberately not a
 * column on `identity_providers`. GitHub is reached through two separate
 * registrations — an OAuth App for signing in, a GitHub App for Importing —
 * and the two share nothing but a vendor. A GitLab row can exist here with no
 * `identity_providers` row at all, and vice versa.
 *
 * A provider's row(s) existing is the only switch. Importing from a Git
 * Provider is available for exactly those providers with at least one row
 * here; there is no Admin-level flag above it, because an operator who wants
 * no repository credentials in the database simply does not create one
 * (ADR-0024).
 *
 * More than one Integration may exist for the same provider — two different
 * GitHub Apps, say, for two different orgs — so `id` rather than `provider`
 * is the row's identity (ADR-0025). A writer chooses which one to connect
 * through; `connections.integration_id` records which app a grant came from.
 */
export const integrations = appTable("integrations", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  // The Git Provider this app is for: `github`, `gitlab`. Plain text rather
  // than an enum, so adding a provider is an insert and not a migration
  // (ADR-0024). The values it may take are the keys of `GIT_PROVIDERS` in
  // `@in-org-quicko/skillset-shared`, checked in the service. No longer unique — see
  // ADR-0025 — so it carries no foreign key from `connections` any more;
  // `connections.integration_id` references `id` instead.
  provider: text("provider").notNull(),
  display_name: text("display_name").notNull(),
  // A free-text note on what this Integration is for. Nullable — there is
  // nothing to say beyond the display name for most rows.
  description: text("description"),
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
