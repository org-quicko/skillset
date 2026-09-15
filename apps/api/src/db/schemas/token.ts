import { sql } from "drizzle-orm";
import { index, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { appTable } from "../schemaFactory.js";
import { users } from "./user";

export const tokens = appTable(
  "tokens",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
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
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    last_used_at: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex("tokens_token_hash_idx").on(table.token_hash),
    userIdIdx: index("tokens_user_id_idx").on(table.user_id),
  }),
);

export type TokenRow = typeof tokens.$inferSelect;
export type NewTokenRow = typeof tokens.$inferInsert;
