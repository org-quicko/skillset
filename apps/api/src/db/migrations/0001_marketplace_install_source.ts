import { sql, type Kysely } from "kysely";

/**
 * Adds `marketplace` to the Install sources: a Plugin's zip fetched by
 * Claude Code from the Registry's marketplace counts as an Install (ADR-0028).
 *
 * @remarks
 * `ADD VALUE` runs inside the migrator's transaction on Postgres 12 and
 * later; nothing in this migration uses the new value, which Postgres forbids
 * before the transaction commits.
 */
export async function up(db: Kysely<unknown>, schema: string): Promise<void> {
  await sql`ALTER TYPE ${sql.id(schema, "skill_install_source")} ADD VALUE IF NOT EXISTS 'marketplace'`.execute(db);
}
