import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DB } from "./database.js";

export type Database = Kysely<DB>;

// `int8` — every count(), and Better Auth's millisecond `last_request` — comes
// back from pg as a string by default. Nothing stored here comes near 2^53, so
// a number is what every caller already expects. Matches `typeMapping` in
// `.kysely-codegenrc.json`.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

/**
 * Opens a Postgres pool and wraps it in a Kysely client scoped to one schema.
 *
 * @remarks
 * Every query the client builds is qualified with `schema` through
 * `withSchema` (ADR-0036), so no query, service, or migration names it. Raw
 * `sql` text is the exception: `withSchema` does not reach inside it, so a raw
 * statement that names a table uses `sql.id(schema, table)` or a query
 * builder reference instead.
 *
 * @param databaseUrl - The Postgres connection string to connect to.
 * @param schema - The Postgres schema every table lives in, already held to
 * `readDbSchema`.
 * @returns The client, and a `close` that ends its pool.
 * @example
 * ```ts
 * const { db, close } = createDatabase(config.databaseUrl, config.dbSchema);
 * await db.selectFrom("tags").selectAll().execute();
 * await close();
 * ```
 */
export function createDatabase(databaseUrl: string, schema: string): { db: Database; close: () => Promise<void> } {
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: databaseUrl }) }),
  }).withSchema(schema);
  return { db, close: () => db.destroy() };
}
