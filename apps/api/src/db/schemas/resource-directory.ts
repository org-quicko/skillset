import { integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { appView } from "../schemaFactory.js";
import { tsvector } from "./column-types";

/**
 * The Resource list's read model (ticket 23, ADR-0026): one row per
 * Resource, joining `resources` to `resource_analytics` (so a Resource with
 * no Install still reads `0`) and aggregating its Tags into a
 * `{id, name}[]` array. A plain view, not materialized — unlike
 * `resource_analytics`, everything here except the install count is always
 * current.
 *
 * `kind` carries no filter yet (ticket 3 gives it one) — every row here is
 * `skill` until a second Kind is registered.
 *
 * Tag *filtering* (matching against one or more selected Tag ids) is done as
 * a membership check against `resource_tags` directly in the query that
 * reads from this view, not as a condition against `tags` — aggregating an
 * array is for display, not for filtering by its contents.
 *
 * Hand-written in its migration, the same as `resource_analytics` and
 * `resources.search` — Drizzle has no `CREATE VIEW` generator either, and
 * this is declared `.existing()` so Drizzle only types queries against it.
 */
export const resourceDirectory = appView("resource_directory", {
  id: uuid("id").notNull(),
  kind: text("kind").notNull(),
  // Never null, unlike `source` below: identity rather than provenance
  // (ADR-0042), so nothing resolves it on the way out.
  namespace: text("namespace").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  published_by_name: text("published_by_name").notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull(),
  // Null for a Resource published straight to this Registry; the read resolves
  // it rather than the view doing so, because the value it resolves to is
  // configuration the database has no access to (ADR-0041).
  source: text("source"),
  // Read out of `payload` by the view (ADR-0026), so the list can show what
  // tool access a Skill claims without a second read per row. Null both when
  // the frontmatter never set it and for a Kind whose payload has no such key.
  allowed_tools: text("allowed_tools"),
  install_count: integer("install_count").notNull(),
  tags: jsonb("tags").notNull().$type<Array<{ id: string; name: string }>>(),
  search: tsvector("search"),
}).existing();
