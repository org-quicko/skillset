import { index, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { appTable } from "../schemaFactory.js";
import { resources } from "./resource";
import { tags } from "./tag";

/**
 * The many-to-many join between Resources and Tags. Both sides cascade:
 * deleting a Resource must not orphan its join rows, and — while no route
 * deletes a Tag today (ADR-0011) — a future one shouldn't have to remember to
 * clean this table up too.
 */
export const resourceTags = appTable(
  "resource_tags",
  {
    resource_id: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    tag_id: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.resource_id, table.tag_id] }),
    tagIdIdx: index("resource_tags_tag_id_idx").on(table.tag_id),
  }),
);

export type ResourceTagRow = typeof resourceTags.$inferSelect;
export type NewResourceTagRow = typeof resourceTags.$inferInsert;
