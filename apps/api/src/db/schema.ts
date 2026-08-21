import { boolean, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Users, Tokens, and Skills land across tickets 02, 03, and 05 — only what the
// current ticket needs is declared here (see docs/data-model.md).
//
// Column names and TS property keys are both snake_case, matching the wire
// (docs/openapi.json) 1:1 — there is no separate camelCase domain shape to
// convert to or from.

export const userRoleEnum = pgEnum("user_role", ["reader", "writer", "admin"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  first_name: text("first_name").notNull(),
  last_name: text("last_name").notNull(),
  // Nullable: a User authenticating through an identity provider has no
  // password at all (ADR-0007). Every read of this column must tolerate null.
  password_hash: text("password_hash"),
  role: userRoleEnum("role").notNull(),
  must_change_password: boolean("must_change_password").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

export const tokens = pgTable(
  "tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Cascade: removing a User must end their CLI access, not orphan it
    // (docs/data-model.md).
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // SHA-256 hex digest of the secret — never the secret itself. See
    // apps/api/src/auth/token.ts for why this is SHA-256, not argon2id.
    token_hash: text("token_hash").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    last_used_at: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex("tokens_token_hash_idx").on(table.token_hash),
    userIdIdx: index("tokens_user_id_idx").on(table.user_id),
  }),
);

export type TokenRow = typeof tokens.$inferSelect;
export type NewTokenRow = typeof tokens.$inferInsert;
