import { sql } from "drizzle-orm";
import { index, jsonb, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { appTable } from "../schemaFactory.js";
import { tsvector } from "./column-types";
import { users } from "./user";

/**
 * A Resource in the Registry — a Skill today, and eventually other Kinds
 * (ADR-0026). One row per Resource, one Artifact per row for a Kind that has
 * one (ADR-0027).
 */
export const resources = appTable(
  "resources",
  {
    // Stable identity for the API's read/delete/artifact routes (ticket 16),
    // and what the Artifact is keyed on in storage from ticket 2 onward
    // (ADR-0026). Generated once, on first insert, and never changes across
    // republishes of the same (kind, name) (`onConflictDoUpdate` never sets it).
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    // Plain text, validated in the service against `KINDS` (ADR-0026) — not a
    // Postgres enum, so registering a new Kind is an insert, not a migration.
    kind: text("kind").notNull(),
    // A Resource's publishing identity is (kind, name), not name alone: an
    // MCP Server and a Skill may share a name (ADR-0026). `PUT` is still an
    // upsert by this pair.
    name: text("name").notNull(),
    description: text("description").notNull(),
    // Markdown documentation — a Skill's SKILL.md body below the frontmatter,
    // supplied by the CLI or the web interface rather than parsed from the
    // Artifact (ADR-0001), or author-written for a Kind with no such
    // convention. Nullable because not every future Kind supplies one
    // (ADR-0026); Skill's own shared validation still requires it.
    body: text("body"),
    // The Kind's own fields, validated by `ResourcePayloadSchema`'s
    // discriminated union in @in-org-quicko/sqillset-shared (ADR-0026). For `skill`,
    // this is the four optional Agent Skills spec fields — see
    // `SkillPayloadSchema`.
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    // Attribution is stored three ways on purpose: the reference gives a
    // current name while the User exists, the email snapshot outlives them
    // being removed, and published_by_name (ticket 23) is a display-name
    // snapshot taken at the same moment, for the Resource list and full-text
    // search below — neither needs a live join to `users`, and neither
    // updates retroactively if that User later renames themselves. Removing
    // a User must not erase who changed a shared Resource.
    published_by: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
    published_by_email: text("published_by_email").notNull(),
    published_by_name: text("published_by_name").notNull(),
    published_at: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // Folds in published_by_name (ticket 23) alongside name and description,
    // so a search term matching only a Resource's publisher still returns it.
    search: tsvector("search").generatedAlwaysAs(
      sql`to_tsvector('english', name || ' ' || coalesce(description, '') || ' ' || published_by_name)`,
    ),
  },
  (table) => ({
    // No check constraint on `name`: no single pattern fits every Kind, so
    // validation lives entirely in the shared per-Kind validators (ADR-0026).
    kindNameUnique: unique("resources_kind_name_unique").on(table.kind, table.name),
    searchIdx: index("resources_search_idx").using("gin", table.search),
    // The new default sort (ADR-0028) needs this; there is no equivalent
    // index left on published_at (docs/data-model.md).
    updatedAtIdx: index("resources_updated_at_idx").on(table.updated_at.desc()),
  }),
);

export type ResourceRow = typeof resources.$inferSelect;
export type NewResourceRow = typeof resources.$inferInsert;
