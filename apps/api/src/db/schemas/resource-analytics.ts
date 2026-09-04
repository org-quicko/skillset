import { integer, pgMaterializedView, uuid } from "drizzle-orm/pg-core";

/**
 * A materialized view of running install counts per Resource, aggregated
 * from `resource_install_events` (ADR-0012, ADR-0028). Refreshed on a
 * schedule — see `refreshInstallCounts` in `../../services/analytics.js` —
 * never read live, so every count shown anywhere can lag reality by up to
 * that interval.
 *
 * Drizzle has no `CREATE MATERIALIZED VIEW` generator, the same gap
 * `resources.search` has for a generated column — its migration is
 * hand-written and this is declared `.existing()` so Drizzle never tries to
 * generate DDL for it, only to type queries against it. A Resource with no
 * recorded Install has no row here; every read path defaults that to 0
 * itself (docs/data-model.md), the same as it did against the plain table
 * this view replaced.
 */
export const resourceAnalytics = pgMaterializedView("resource_analytics", {
  resource_id: uuid("resource_id").notNull(),
  install_count: integer("install_count").notNull(),
}).existing();
