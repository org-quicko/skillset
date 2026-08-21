import { sql } from "drizzle-orm";
import { boolean, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Users, Tokens, and Skills land across tickets 02, 03, and 05 — only what the
// current ticket needs is declared here (see docs/data-model.md).
//
// Column names and TS property keys are both snake_case, matching the wire
// (docs/openapi.json) 1:1 — there is no separate camelCase domain shape to
// convert to or from.

export const userRoleEnum = pgEnum("user_role", ["reader", "writer", "admin", "superadmin"]);

export const users = pgTable(
  "users",
  {
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
  },
  (table) => [
    // At most one superadmin, ever — set once at /setup and never
    // reassigned. The database enforces the cardinality; the application
    // enforces that it's never granted, changed, or removed afterwards.
    uniqueIndex("users_role_superadmin_index").on(table.role).where(sql`${table.role} = 'superadmin'`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
