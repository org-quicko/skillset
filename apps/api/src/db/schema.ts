import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgMaterializedView,
  pgTable,
  pgView,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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
    // Postgres 18's native uuidv7() (this repo runs postgres:18-alpine) —
    // time-ordered, so an id sorts the same as its row's creation order,
    // unlike the random v4 gen_random_uuid() this replaced.
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
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

export const tokens = pgTable(
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

/** Postgres `tsvector` has no native representation in Drizzle (docs/data-model.md). */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

export const skills = pgTable(
  "skills",
  {
    // Stable identity for the API's read/delete/artifact routes (ticket 16).
    // Generated once, on first insert, and never changes across
    // republishes of the same name (`onConflictDoUpdate` never sets it).
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    // The Skill's name is still how it's published (`PUT /skills/{name}` is
    // a name-keyed upsert, ADR-0002) and how the Artifact is keyed in
    // storage — just no longer the primary key.
    name: text("name").notNull().unique(),
    description: text("description").notNull(),
    // The SKILL.md body as supplied by the publisher. The API never reads the
    // Artifact (ADR-0001), so this is not parsed out of it.
    body: text("body").notNull(),
    // The four optional Agent Skills spec fields (docs/data-model.md). Each
    // is null until a publish sets it, and publishing never partially
    // clears one — either the whole frontmatter validates or the publish is
    // refused (ADR-0009).
    license: text("license"),
    compatibility: text("compatibility"),
    metadata: jsonb("metadata").$type<Record<string, string>>(),
    allowed_tools: text("allowed_tools"),
    // Attribution is stored three ways on purpose: the reference gives a
    // current name while the User exists, the email snapshot outlives them
    // being removed, and published_by_name (ticket 23) is a display-name
    // snapshot taken at the same moment, for the Skill list and full-text
    // search below — neither needs a live join to `users`, and neither
    // updates retroactively if that User later renames themselves. Removing
    // a User must not erase who changed a shared Skill.
    published_by: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
    published_by_email: text("published_by_email").notNull(),
    published_by_name: text("published_by_name").notNull(),
    published_at: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // Folds in published_by_name (ticket 23) alongside name and description,
    // so a search term matching only a Skill's publisher still returns it.
    search: tsvector("search").generatedAlwaysAs(
      sql`to_tsvector('english', name || ' ' || coalesce(description, '') || ' ' || published_by_name)`,
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

/**
 * The Tag catalog — registry-wide, not scoped to any one Skill (ADR-0008,
 * ADR-0011). `name` is stored already lowercased and trimmed (the shared
 * `validateTagName` normalises before this is ever written), so a plain
 * unique index is enough to catch a collision; there's no need for a
 * case-insensitive functional index.
 */
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    name: text("name").notNull().unique(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // The same rule the shared validation module applies, enforced where the
    // row is written rather than trusted from the caller.
    nameFormat: check(
      "tags_name_format",
      sql`${table.name} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(${table.name}) <= 32`,
    ),
  }),
);

export type TagRow = typeof tags.$inferSelect;
export type NewTagRow = typeof tags.$inferInsert;

/**
 * The many-to-many join between Skills and Tags. Both sides cascade: deleting
 * a Skill must not orphan its join rows, and — while no route deletes a Tag
 * today (ADR-0011) — a future one shouldn't have to remember to clean this
 * table up too.
 */
export const skillTags = pgTable(
  "skill_tags",
  {
    skill_id: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    tag_id: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.skill_id, table.tag_id] }),
    tagIdIdx: index("skill_tags_tag_id_idx").on(table.tag_id),
  }),
);

export type SkillTagRow = typeof skillTags.$inferSelect;
export type NewSkillTagRow = typeof skillTags.$inferInsert;

/**
 * Where a recorded Install came from (ADR-0012): today only a web Download,
 * eventually also `skillreg add` (ticket 09) once it exists.
 */
export const skillInstallSourceEnum = pgEnum("skill_install_source", ["web", "cli"]);

/**
 * The Install event log (ADR-0012, spec: `.scratch/skill-analytics/spec.md`)
 * — one immutable row per Install, an append-only history rather than a
 * running total. `skill_analytics` (below) is the aggregate derived from
 * this table; nothing reads a Skill's install count from here directly.
 *
 * No `updated_at`: every other table carries the created_at/updated_at pair
 * by convention, but a row here is never touched again after insert — a
 * column that can only ever equal `created_at` would be a bare column, not
 * genuine consistency with the rest of the schema.
 */
export const skillInstallEvents = pgTable(
  "skill_install_events",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    skill_id: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    source: skillInstallSourceEnum("source").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    skillIdIdx: index("skill_install_events_skill_id_idx").on(table.skill_id),
  }),
);

export type SkillInstallEventRow = typeof skillInstallEvents.$inferSelect;
export type NewSkillInstallEventRow = typeof skillInstallEvents.$inferInsert;

/**
 * A materialized view of running install counts per Skill, aggregated from
 * `skill_install_events` (ADR-0012). Refreshed on a schedule — see
 * `refreshInstallCounts` in `../services/analytics.js` — never read live, so
 * every count shown anywhere can lag reality by up to that interval.
 *
 * Drizzle has no `CREATE MATERIALIZED VIEW` generator, the same gap
 * `skills.search` (above) has for a generated column — its migration is
 * hand-written and this is declared `.existing()` so Drizzle never tries to
 * generate DDL for it, only to type queries against it. A Skill with no
 * recorded Install has no row here; every read path defaults that to 0
 * itself (docs/data-model.md), the same as it did against the plain table
 * this view replaced.
 */
export const skillAnalytics = pgMaterializedView("skill_analytics", {
  skill_id: uuid("skill_id").notNull(),
  install_count: integer("install_count").notNull(),
}).existing();

/**
 * The Skill list's read model (ticket 23): one row per Skill, joining
 * `skills` to `skill_analytics` (so a Skill with no Install still reads `0`)
 * and aggregating its Tags into a `{id, name}[]` array. A plain view, not
 * materialized — unlike `skill_analytics`, everything here except the
 * install count is always current.
 *
 * Tag *filtering* (matching against one or more selected Tag ids) is done as
 * a membership check against `skill_tags` directly in the query that reads
 * from this view, not as a condition against `tags` below — aggregating an
 * array is for display, not for filtering by its contents.
 *
 * Hand-written in its migration, the same as `skill_analytics` above and
 * `skills.search` — Drizzle has no `CREATE VIEW` generator either, and this
 * is declared `.existing()` so Drizzle only types queries against it.
 */
export const skillDirectory = pgView("skill_directory", {
  id: uuid("id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  published_by_name: text("published_by_name").notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull(),
  install_count: integer("install_count").notNull(),
  tags: jsonb("tags").notNull().$type<Array<{ id: string; name: string }>>(),
  search: tsvector("search"),
}).existing();
