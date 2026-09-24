import { sql } from "kysely";
import { Migrator, type Migration, type MigrationProvider } from "kysely/migration";
import type { Database } from "./client.js";
import { migrations } from "./migrations/index.js";

const READY_CHECK_RETRIES = 30;
const READY_CHECK_DELAY_MS = 1000;

/** The application waits for Postgres to be ready before serving. */
export async function waitForDatabase(db: Database): Promise<void> {
  for (let attempt = 1; attempt <= READY_CHECK_RETRIES; attempt++) {
    try {
      await sql`SELECT 1`.execute(db);
      return;
    } catch (error) {
      if (attempt === READY_CHECK_RETRIES) {
        throw new Error(
          `Database was not ready after ${READY_CHECK_RETRIES} attempts: ${String(error)}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, READY_CHECK_DELAY_MS));
    }
  }
}

/** Serves `./migrations` to Kysely's migrator, each bound to the schema it runs in. */
class SchemaMigrationProvider implements MigrationProvider {
  constructor(private readonly schema: string) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    return Object.fromEntries(
      Object.entries(migrations).map(([name, migration]) => [
        name,
        { up: (db) => migration.up(db, this.schema) },
      ]),
    );
  }
}

/**
 * Brings the database up to the latest migration.
 *
 * @remarks
 * Runs through Kysely's migrator, which serialises concurrent replicas on its
 * own lock table and applies every pending migration in one transaction, so
 * running this repeatedly is idempotent.
 *
 * Its bookkeeping (`kysely_migration`, `kysely_migration_lock`) lives in
 * `schema`, so two apps sharing one database keep separate ledgers, and the
 * migrator creates that schema when it does not exist yet — Postgres never
 * creates one on its own (ADR-0036).
 *
 * @param db - The Kysely client, scoped to `schema`.
 * @param schema - The schema `db` is scoped to.
 * @throws Error if a migration fails; every migration in that run is rolled back.
 * @example
 * ```ts
 * await runMigrations(db, config.dbSchema);
 * ```
 */
export async function runMigrations(db: Database, schema: string): Promise<void> {
  const migrator = new Migrator({
    db,
    migrationTableSchema: schema,
    provider: new SchemaMigrationProvider(schema),
  });

  const { error } = await migrator.migrateToLatest();
  if (error) throw error;
}
