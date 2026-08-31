import { integer, jsonb, pgView, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tsvector } from "./column-types";

/**
 * The Skill list's read model (ticket 23): one row per Skill, joining
 * `skills` to `skill_analytics` (so a Skill with no Install still reads `0`)
 * and aggregating its Tags into a `{id, name}[]` array. A plain view, not
 * materialized — unlike `skill_analytics`, everything here except the
 * install count is always current.
 *
 * Tag *filtering* (matching against one or more selected Tag ids) is done as
 * a membership check against `skill_tags` directly in the query that reads
 * from this view, not as a condition against `tags` — aggregating an array is
 * for display, not for filtering by its contents.
 *
 * Hand-written in its migration, the same as `skill_analytics` and
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
