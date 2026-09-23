import { sql } from "drizzle-orm";
import { index, jsonb, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { appTable } from "../schemaFactory.js";
import { users } from "./user";

/**
 * A Resource someone installed from a repository and put forward for the
 * Registry, until an Admin approves or rejects it (ADR-0044).
 *
 * @remarks
 * Its own table rather than a status on `resources`, so every catalog read —
 * the directory, search, stats, by-name, the Artifact — stays unable to reach
 * an unapproved row without having to remember to filter one out.
 *
 * Shaped like `resources` on purpose: approving copies this row across column
 * for column, and the `kind` and `payload` pair covers any Kind the same way
 * it does there (ADR-0026).
 */
export const resourceSubmissions = appTable(
  "resource_submissions",
  {
    // Keys the Submission's files in storage, under `submissions/<id>/`.
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    kind: text("kind").notNull(),
    namespace: text("namespace").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    body: text("body"),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    // Never null: a Submission exists because the bytes came from a
    // repository rather than from this Registry.
    source: text("source").notNull(),
    // Snapshotted alongside the reference for the same reason `resources`
    // snapshots its publisher: removing a User must not erase who asked.
    submitted_by: uuid("submitted_by").references(() => users.id, { onDelete: "set null" }),
    submitted_by_email: text("submitted_by_email").notNull(),
    submitted_by_name: text("submitted_by_name").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // One pending Submission per identity: submitting the same Resource again
    // replaces what was waiting rather than queueing a second copy.
    kindNamespaceNameUnique: unique("resource_submissions_kind_namespace_name_unique").on(
      table.kind,
      table.namespace,
      table.name,
    ),
    createdAtIdx: index("resource_submissions_created_at_idx").on(table.created_at.desc()),
  }),
);

export type ResourceSubmissionRow = typeof resourceSubmissions.$inferSelect;
export type NewResourceSubmissionRow = typeof resourceSubmissions.$inferInsert;
