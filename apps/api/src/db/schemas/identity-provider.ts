import { sql } from "drizzle-orm";
import { boolean, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const identityProviderKindEnum = pgEnum("identity_provider_kind", [
  "google",
  "microsoft",
  "github",
]);

/**
 * A configured way to log in without a password (ADR-0015). At most one row per
 * kind (ADR-0017); any number of them may be enabled, and every enabled one is
 * offered on the login page.
 *
 * There is deliberately no `user_identities` table alongside this: a login is
 * matched to a User by the verified email the Provider asserts, so the `users`
 * row *is* the identity and one person signing in through two Providers is one
 * row, not two links.
 *
 * There is no issuer URL either. Better Auth knows each kind's endpoints
 * (ADR-0016), so what an Admin configures is the credential pair and the
 * organisations to admit — nothing about the protocol.
 */
export const identityProviders = pgTable(
  "identity_providers",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    // The Provider's identity, not merely a label: one Google, one Microsoft,
    // one GitHub (ADR-0017). Better Auth keys its `socialProviders` the same
    // way, which is what makes a row and a configured provider the same thing.
    kind: identityProviderKindEnum("kind").notNull().unique(),
    display_name: text("display_name").notNull(),
    client_id: text("client_id").notNull(),
    // Stored as given, following listmonk (ADR-0015). Written and never read
    // back out over the wire — no response shape includes it.
    client_secret: text("client_secret").notNull(),
    // Workspace domains (`hd`), tenant ids (`tid`), or GitHub organisation
    // logins, by kind. A login is admitted if it matches any one of them.
    //
    // Empty is a configuration, not a blank: it means no organisation check
    // runs, and every account the provider authenticates gets a `reader` here
    // (ADR-0021). It was once impossible — a check constraint refused an
    // enabled Provider without one, because it is the only control on who gets
    // an account — and that constraint is deliberately gone. An operator who
    // empties this is opening the Registry to everyone the provider will
    // authenticate, which for GitHub is the whole internet.
    permitted_organisations: text("permitted_organisations")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    enabled: boolean("enabled").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export type IdentityProviderRow = typeof identityProviders.$inferSelect;
export type NewIdentityProviderRow = typeof identityProviders.$inferInsert;
