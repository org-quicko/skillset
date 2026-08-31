import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tsvector } from "./column-types";
import { users } from "./user";

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
