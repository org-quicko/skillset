import { sql, type Kysely } from "kysely";

/**
 * Adds `marketplace_settings`: the details an Admin gives the Registry's
 * Claude Code marketplace (its name, owner, and description).
 *
 * @remarks
 * One row at most, held there by a `true`-only primary key. Until an Admin
 * saves, there is no row and the marketplace uses its defaults.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("marketplace_settings")
    .addColumn("id", "boolean", (col) =>
      col
        .primaryKey()
        .defaultTo(true)
        .check(sql`id`),
    )
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("owner_name", "text", (col) => col.notNull())
    .addColumn("owner_email", "text")
    .addColumn("description", "text")
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
}
