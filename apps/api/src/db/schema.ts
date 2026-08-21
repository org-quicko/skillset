import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

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

/** Postgres `tsvector` has no native representation in Drizzle (docs/data-model.md). */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

export const skills = pgTable(
  "skills",
  {
    // The Skill's name is its sole identity — flat, no namespacing, no
    // version history. Publishing replaces the row (ADR-0002).
    name: text("name").primaryKey(),
    description: text("description").notNull(),
    // The SKILL.md body as supplied by the publisher. The API never reads the
    // Artifact (ADR-0001), so this is not parsed out of it.
    body: text("body").notNull(),
    // Attribution is stored twice on purpose: the reference gives a current
    // name while the User exists, and the email snapshot outlives them being
    // removed. Removing a User must not erase who changed a shared Skill.
    published_by: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
    published_by_email: text("published_by_email").notNull(),
    published_at: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    search: tsvector("search").generatedAlwaysAs(
      sql`to_tsvector('english', name || ' ' || coalesce(description, ''))`,
    ),
  },
  (table) => ({
    // The same rule the shared validation module applies, enforced where the
    // row is written rather than trusted from the caller.
    nameFormat: check(
      "skills_name_format",
      sql`${table.name} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(${table.name}) <= 64`,
    ),
    searchIdx: index("skills_search_idx").using("gin", table.search),
    publishedAtIdx: index("skills_published_at_idx").on(table.published_at.desc()),
  }),
);

export type SkillRow = typeof skills.$inferSelect;
export type NewSkillRow = typeof skills.$inferInsert;
