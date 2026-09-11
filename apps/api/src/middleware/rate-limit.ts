import { createMiddleware } from "hono/factory";
import { AppError } from "../lib/errors.js";
import type { ClientIpEnv } from "./client-ip.js";

/** One bucket's shape: how many requests, over how long. */
export interface RateLimitRule {
  windowSeconds: number;
  max: number;
}

/**
 * A path prefix with a tighter bucket than the default.
 *
 * @remarks
 * Matched on `c.req.path`, longest prefix first, so `/api/imports` can be
 * stricter than `/api` without the order they are declared in mattering.
 */
export interface RateLimitOverride extends RateLimitRule {
  prefix: string;
}

export interface RateLimitOptions extends RateLimitRule {
  overrides?: RateLimitOverride[];
}

/** Too many requests — the one 429 this API answers with. */
export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(429, "rate_limited", `Too many requests. Try again in ${retryAfterSeconds}s.`);
  }
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Refuses a client that has made too many requests in a window.
 *
 * @remarks
 * Better Auth limits its own routes (`rateLimit` in features/auth/instance.ts)
 * and nothing limited the rest, which left Bearer-Token guessing, zip
 * assembly, full-text search, and the import routes that fan out to GitHub
 * all unbounded (ISSUE-7). This is the floor under all of them.
 *
 * Deliberately in memory and deliberately small. It is a fixed window, not a
 * sliding one, and its buckets are per process, so two replicas allow twice
 * the traffic one does and a restart forgets everything. That is the honest
 * shape of a defence against a script hammering one endpoint, which is what
 * this is for; a distributed limit belongs in the proxy in front of the app,
 * where the address is known first-hand. The credential endpoints that
 * genuinely need a shared count are Better Auth's, and those are limited in
 * Postgres.
 *
 * Keyed on `clientIp`, which `clientIp` middleware has already resolved from
 * the socket or a trusted proxy — never from a header the caller wrote. A
 * request with no knowable address shares one bucket rather than escaping the
 * limit.
 *
 * @param options - The default bucket, and any tighter per-prefix ones.
 * @returns A middleware handler.
 * @throws RateLimitedError when the caller's bucket for this prefix is full.
 * @example
 * ```ts
 * app.use(
 *   "/api/*",
 *   rateLimit({
 *     windowSeconds: 60,
 *     max: 600,
 *     overrides: [{ prefix: "/api/imports", windowSeconds: 60, max: 30 }],
 *   }),
 * );
 * ```
 */
export function rateLimit(options: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  // Longest first, so the most specific prefix wins however they were listed.
  const overrides = [...(options.overrides ?? [])].sort((a, b) => b.prefix.length - a.prefix.length);

  return createMiddleware<ClientIpEnv>(async (c, next) => {
    const override = overrides.find((candidate) => c.req.path.startsWith(candidate.prefix));
    const rule: RateLimitRule = override ?? options;
    const key = `${c.var.clientIp ?? "unknown"}|${override?.prefix ?? ""}`;

    const now = Date.now();
    // Every entry carries its own expiry, so one sweep per request keeps the
    // map bounded by the number of clients currently inside a window rather
    // than by every client ever seen.
    for (const [entryKey, entry] of buckets) {
      if (entry.resetAt <= now) buckets.delete(entryKey);
    }

    const bucket = buckets.get(key);
    if (!bucket) {
      buckets.set(key, { count: 1, resetAt: now + rule.windowSeconds * 1000 });
      await next();
      return;
    }

    if (bucket.count >= rule.max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      c.header("retry-after", String(retryAfter));
      throw new RateLimitedError(retryAfter);
    }

    bucket.count += 1;
    await next();
  });
}
