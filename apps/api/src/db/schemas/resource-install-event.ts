import { sql } from "drizzle-orm";
import { index, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { appEnum, appTable } from "../schemaFactory.js";
import { resources } from "./resource";

/**
 * Where a recorded Install came from (ADR-0012): a web Download for a Kind
 * with an Artifact, `sqillset add` (ticket 09), or the MCP server (ticket
 * 48). The Postgres type is still named `skill_install_source` — nothing
 * about "where an Install came from" is Skill-specific, but renaming it is
 * out of this ticket's scope (spec: `.scratch/generic-resources/spec.md`).
 */
export const resourceInstallSourceEnum = appEnum("skill_install_source", ["web", "cli", "mcp"]);

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
export const resourceInstallEvents = appTable(
  "resource_install_events",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    resource_id: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    source: resourceInstallSourceEnum("source").notNull(),
    // A digest of the client's address and user agent, never either of them
    // (see features/analytics/fingerprint.ts). Null when the client could not
    // be identified, and null is what keeps those rows outside the unique
    // index below — Postgres treats nulls as distinct, so an unidentifiable
    // Install is counted without deduplication rather than discarded.
    client_fingerprint: text("client_fingerprint"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    resourceIdIdx: index("resource_install_events_resource_id_idx").on(table.resource_id),
    // One Install per client per Resource per UTC day (ISSUE-23). The day is
    // an expression rather than a column because a column would be a second
    // copy of `created_at` that could disagree with it; `AT TIME ZONE 'UTC'`
    // is what makes the cast immutable enough to index, and fixes the
    // boundary to UTC rather than whatever the session's TimeZone happens to
    // be.
    perClientPerDay: uniqueIndex("resource_install_events_dedupe_idx").on(
      table.resource_id,
      table.client_fingerprint,
      sql`((${table.created_at} AT TIME ZONE 'UTC')::date)`,
    ),
  }),
);

export type ResourceInstallEventRow = typeof resourceInstallEvents.$inferSelect;
export type NewResourceInstallEventRow = typeof resourceInstallEvents.$inferInsert;
