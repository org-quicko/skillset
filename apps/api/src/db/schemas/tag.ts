import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
