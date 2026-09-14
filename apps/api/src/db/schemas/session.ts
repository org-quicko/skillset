import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./user";

/**
 * Better Auth's session model (ADR-0016). Nothing in this codebase writes to
 * this table directly — Better Auth owns every row.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    // What the session cookie carries. Unlike the JWT it replaces (ADR-0005),
    // this is a database row, so logging out revokes rather than merely
    // clearing a cookie and hoping the token expires.
    token: text("token").notNull().unique(),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip_address: text("ip_address"),
    user_agent: text("user_agent"),
    // Cascade for the same reason Tokens cascade: removing a User must end
    // their access, not orphan it (docs/data-model.md).
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sessions_user_id_idx").on(table.user_id)],
);

export type SessionRow = typeof sessions.$inferSelect;
