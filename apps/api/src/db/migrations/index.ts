import type { Kysely } from "kysely";
import * as baseline from "./0000_baseline.js";
import * as marketplaceInstallSource from "./0001_marketplace_install_source.js";
import * as marketplaceSettings from "./0002_marketplace_settings.js";
import * as searchByKind from "./0003_search_by_kind.js";

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
  "0001_marketplace_install_source": marketplaceInstallSource,
  "0002_marketplace_settings": marketplaceSettings,
  "0003_search_by_kind": searchByKind,
};
