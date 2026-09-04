import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { resources } from "./resource";

/**
 * Where a recorded Install came from (ADR-0012): a web Download for a Kind
 * with an Artifact, or `skillreg add` (ticket 09). The Postgres type is
 * still named `skill_install_source` — nothing about "where an Install came
 * from" is Skill-specific, but renaming it is out of this ticket's scope
 * (spec: `.scratch/generic-resources/spec.md`).
 */
export const resourceInstallSourceEnum = pgEnum("skill_install_source", ["web", "cli"]);

/**
 * The Install event log (ADR-0012, ADR-0028, spec: `.scratch/skill-analytics/spec.md`)
 * — one immutable row per Install, an append-only history rather than a
 * running total. `resource_analytics` is the aggregate derived from this
 * table; nothing reads a Resource's install count from here directly.
 *
 * No `updated_at`: every other table carries the created_at/updated_at pair
 * by convention, but a row here is never touched again after insert — a
 * column that can only ever equal `created_at` would be a bare column, not
 * genuine consistency with the rest of the schema.
 */
export const resourceInstallEvents = pgTable(
  "resource_install_events",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    resource_id: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    source: resourceInstallSourceEnum("source").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    resourceIdIdx: index("resource_install_events_resource_id_idx").on(table.resource_id),
  }),
);

export type ResourceInstallEventRow = typeof resourceInstallEvents.$inferSelect;
export type NewResourceInstallEventRow = typeof resourceInstallEvents.$inferInsert;
