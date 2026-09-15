import { sql } from "drizzle-orm";
import { index, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { appTable } from "../schemaFactory.js";

/**
 * Better Auth's verification model (ADR-0016) — short-lived values keyed by an
 * identifier. Nothing in this codebase writes to this table directly.
 */
export const verifications = appTable(
  "verifications",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

export type VerificationRow = typeof verifications.$inferSelect;
