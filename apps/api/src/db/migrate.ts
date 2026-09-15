import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type postgres from "postgres";
import { advisoryLockKey } from "./advisory-lock.js";
import type { Database } from "./client.js";

const READY_CHECK_RETRIES = 30;
const READY_CHECK_DELAY_MS = 1000;

/** The application waits for Postgres to be ready before serving. */
export async function waitForDatabase(sql: postgres.Sql): Promise<void> {
  for (let attempt = 1; attempt <= READY_CHECK_RETRIES; attempt++) {
    try {
      await sql`SELECT 1`;
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

const MIGRATION_LOCK_KEY = advisoryLockKey("sqillset:migrations");

// Resolved relative to this module rather than process.cwd(), so it's
// correct regardless of where the process was launched from.
const DEFAULT_MIGRATIONS_FOLDER = join(import.meta.dir, "../../drizzle");

/**
 * Runs pending migrations under a Postgres advisory lock so that a future
 * multi-replica deployment can't race and corrupt the schema. drizzle's
 * migrator itself tracks applied migrations in `__drizzle_migrations`, so
 * running this repeatedly is idempotent.
 */
export async function runMigrations(
  sql: postgres.Sql,
  db: Database,
  migrationsFolder = DEFAULT_MIGRATIONS_FOLDER,
): Promise<void> {
  await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
  }
}
