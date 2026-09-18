import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type postgres from "postgres";
import { advisoryLockKey } from "./advisory-lock.js";
import type { Database } from "./client.js";
import { dbSchema } from "./schemaFactory.js";
import { DEFAULT_DB_SCHEMA, MIGRATION_SCHEMA_SENTINEL } from "./schemaName.js";

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

const MIGRATION_LOCK_KEY = advisoryLockKey("skillset:migrations");

// Resolved relative to this module rather than process.cwd(), so it's
// correct regardless of where the process was launched from.
const DEFAULT_MIGRATIONS_FOLDER = join(import.meta.dir, "../../drizzle");

/**
 * Writes a copy of the migrations with the schema sentinel resolved.
 *
 * @remarks
 * drizzle's migrator reads SQL straight off disk, so the substitution cannot
 * be a hook — the files it reads have to be the resolved ones. They are
 * written to a temporary directory rather than over `drizzle/`, which is
 * shipped read-only and has to stay a template for the next deployment.
 *
 * `__drizzle_migrations` records a hash of each file, so the recorded hashes
 * differ per schema. That is harmless: the table lives in the same schema as
 * the objects it describes, and is never compared across databases.
 *
 * @param migrationsFolder - The template migrations, as shipped.
 * @param schemaName - The schema to resolve the sentinel to.
 * @returns The path to the temporary folder, for the caller to remove.
 * @throws Error if the folder cannot be read or copied.
 */
async function resolveMigrations(migrationsFolder: string, schemaName: string): Promise<string> {
  const resolved = await mkdtemp(join(tmpdir(), "skillset-migrations-"));
  await cp(migrationsFolder, resolved, { recursive: true });

  for (const entry of await readdir(resolved)) {
    if (!entry.endsWith(".sql")) continue;
    const path = join(resolved, entry);
    const template = await readFile(path, "utf8");
    await writeFile(path, template.replaceAll(MIGRATION_SCHEMA_SENTINEL, schemaName));
  }

  return resolved;
}

/**
 * Runs pending migrations under a Postgres advisory lock so that a future
 * multi-replica deployment can't race and corrupt the schema. drizzle's
 * migrator itself tracks applied migrations in `__drizzle_migrations`, so
 * running this repeatedly is idempotent.
 *
 * @remarks
 * Creates the schema `DB_SCHEMA` names first, since Postgres never creates
 * one on its own and this database is meant to be divided by schema across
 * apps rather than dedicated to just one. The application owns that rather
 * than the Postgres image's init hooks, which only fire on a fresh data
 * directory and so miss a schema introduced after the volume was made.
 *
 * The shipped SQL names its schema through a sentinel, resolved here — see
 * `resolveMigrations`. drizzle's own bookkeeping table goes into the same
 * schema, so two apps sharing one database do not read each other's applied
 * migrations out of a single `drizzle.__drizzle_migrations`.
 *
 * @param sql - The connection to take the advisory lock on.
 * @param db - The Drizzle client the migrator runs through.
 * @param migrationsFolder - Where the generated SQL lives; defaults to
 * `drizzle/` beside the app.
 * @throws Error if a migration fails, after the lock is released.
 */
export async function runMigrations(
  sql: postgres.Sql,
  db: Database,
  migrationsFolder = DEFAULT_MIGRATIONS_FOLDER,
): Promise<void> {
  const resolved = await resolveMigrations(migrationsFolder, dbSchema);

  await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
  try {
    if (dbSchema !== DEFAULT_DB_SCHEMA) {
      await sql`CREATE SCHEMA IF NOT EXISTS ${sql(dbSchema)}`;
    }
    await migrate(db, { migrationsFolder: resolved, migrationsSchema: dbSchema });
  } finally {
    await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
    await rm(resolved, { recursive: true, force: true });
  }
}
