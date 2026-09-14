import { createHash } from "node:crypto";

/**
 * Postgres advisory locks share one keyspace across the whole cluster, so the
 * key is derived from a namespaced name rather than picked as an arbitrary
 * literal that could collide with another lock, app, or service.
 */
export function advisoryLockKey(name: string): number {
  return createHash("sha256").update(name).digest().readInt32BE(0);
}
