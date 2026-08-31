import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { skills } from "./skill";

/**
 * Where a recorded Install came from (ADR-0012): today only a web Download,
 * eventually also `skillreg add` (ticket 09) once it exists.
 */
export const skillInstallSourceEnum = pgEnum("skill_install_source", ["web", "cli"]);

/**
 * The Install event log (ADR-0012, spec: `.scratch/skill-analytics/spec.md`)
 * — one immutable row per Install, an append-only history rather than a
 * running total. `skill_analytics` is the aggregate derived from this table;
 * nothing reads a Skill's install count from here directly.
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
