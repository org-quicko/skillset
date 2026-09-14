import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { createMiddleware } from "hono/factory";

/** What `clientIp` puts on the context: the address this request really came from, if one is knowable. */
export type ClientIpEnv = { Variables: { clientIp: string | undefined } };

const FORWARDED_FOR = "x-forwarded-for";

/**
 * Resolves the address a request actually came from, and rewrites
 * `x-forwarded-for` to hold exactly that.
 *
 * @remarks
 * `x-forwarded-for` is a header the client writes. Anything downstream that
 * reads it — this app's rate limiter, Better Auth's own limiter, and the
 * `sessions.ip_address` column — was therefore keyed on a value the client
 * chose, so a password-guessing client could pick a fresh address per request
 * and never fill a bucket (ISSUE-7).
 *
 * The address is always taken from the socket, never from the forwarded
 * chain, and the header is then *overwritten* with that single address, which
 * is what makes the fix reach Better Auth. Better Auth reads the client IP
 * from headers alone and has no access to the socket, so handing it a header
 * this app has already vouched for is the only way to give it a trustworthy
 * address — and rewriting rather than appending means a value the client
 * supplied cannot survive to be read.
 *
 * @returns A middleware handler that sets `clientIp` on the context.
 * @example
 * ```ts
 * app.use("*", clientIp());
 * ```
 */
export function clientIp() {
  return createMiddleware<ClientIpEnv>(async (c, next) => {
    const address = socketAddress(c);
    c.set("clientIp", address);
    rewriteForwardedFor(c, address);
    await next();
  });
}

/** `undefined` under `app.request(...)`, which has no socket behind it — every test, and nothing else. */
function socketAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

/**
 * Replaces the request's `x-forwarded-for` with the one resolved address, or
 * removes it when there is none.
 *
 * @remarks
 * Bun's incoming request headers are mutable, so the common path is a `set`.
 * The rebuilt request is the fallback for a runtime that guards them instead
 * — the same `c.req.raw` reassignment `hono/body-limit` makes.
 */
function rewriteForwardedFor(c: Context, address: string | undefined): void {
  const apply = (headers: Headers) => {
    if (address) headers.set(FORWARDED_FOR, address);
    else headers.delete(FORWARDED_FOR);
  };

  try {
    apply(c.req.raw.headers);
  } catch {
    const headers = new Headers(c.req.raw.headers);
    apply(headers);
    c.req.raw = new Request(c.req.raw, { headers });
  }
}
