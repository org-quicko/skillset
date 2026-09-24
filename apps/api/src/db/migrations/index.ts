import type { Kysely } from "kysely";
import * as baseline from "./0000_baseline.js";

/**
 * A migration, handed the schema it runs in alongside a client already scoped
 * to it — for the SQL `withSchema` does not qualify (see ./README.md).
 */
export interface SchemaMigration {
  up(db: Kysely<unknown>, schema: string): Promise<void>;
}

/** Every migration, by the name the migrator records and orders it by. */
export const migrations: Record<string, SchemaMigration> = {
  "0000_baseline": baseline,
};
