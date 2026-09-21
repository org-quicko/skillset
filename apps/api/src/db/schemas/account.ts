import { sql } from "drizzle-orm";
import { index, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { appTable } from "../schemaFactory.js";
import { users } from "./user";

/**
 * Better Auth's account model (ADR-0016) — one row per way a User can sign in.
 * Nothing in this codebase writes to this table directly.
 */
export const accounts = appTable(
  "accounts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    // `credential` for a password, or the Provider's kind for an external
    // login (ADR-0017). `account_id` is this User's identifier at that
    // provider — their own id for a password account.
    account_id: text("account_id").notNull(),
    provider_id: text("provider_id").notNull(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Where `users.password_hash` used to live. Still argon2id, still never
    // plaintext — only the column moved (ADR-0016). Null for every account
    // that is not a password.
    password: text("password"),
    access_token: text("access_token"),
    refresh_token: text("refresh_token"),
    id_token: text("id_token"),
    access_token_expires_at: timestamp("access_token_expires_at", { withTimezone: true }),
    refresh_token_expires_at: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("accounts_user_id_idx").on(table.user_id),
    // One account per provider and identity — the same pair Better Auth
    // matches on, and what makes a repeated login find the existing account
    // instead of adding a row each time. Also the `ON CONFLICT` target
    // `setPasswordCredential` upserts against.
    uniqueIndex("accounts_provider_account_idx").on(table.provider_id, table.account_id),
  ],
);

export type AccountRow = typeof accounts.$inferSelect;
