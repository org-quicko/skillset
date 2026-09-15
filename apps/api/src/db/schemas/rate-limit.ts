import { sql } from "drizzle-orm";
import { bigint, integer, text, uuid } from "drizzle-orm/pg-core";
import { appTable } from "../schemaFactory.js";

/**
 * Better Auth's rate-limit counters (ISSUE-7). Nothing in this codebase reads
 * or writes this table — Better Auth owns every row, the same way it owns
 * `sessions`.
 *
 * It exists because the alternative is worse: Better Auth's default limiter
 * keeps its buckets in process memory, which means one bucket per replica and
 * none at all after a restart. `rateLimit.storage: "database"` points it here
 * instead, so the password sign-in limit holds across every replica and
 * survives a redeploy.
 */
export const rateLimits = appTable("rate_limits", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  // `<ip>|<path>`, or `no-trusted-ip|<path>` when no client address can be
  // resolved — see `advanced.ipAddress` in features/auth/instance.ts.
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  // Epoch milliseconds, not a timestamp: Better Auth compares it to
  // `Date.now()` and writes it as a number.
  last_request: bigint("last_request", { mode: "number" }).notNull(),
});

export type RateLimitRow = typeof rateLimits.$inferSelect;
