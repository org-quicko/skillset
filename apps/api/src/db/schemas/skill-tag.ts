import { index, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { skills } from "./skill";
import { tags } from "./tag";

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
