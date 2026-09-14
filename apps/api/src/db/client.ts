import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schemas/index.js";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Opens a Postgres connection and wraps it in a Drizzle client.
 *
 * @param databaseUrl - The Postgres connection string to connect to.
 * @returns `{ sql: postgres.Sql; db: Database }`
 */
export function createDatabase(databaseUrl: string): { sql: postgres.Sql; db: Database } {
  const sql = postgres(databaseUrl);
  const db = drizzle(sql, { schema });
  return { sql, db };
}
