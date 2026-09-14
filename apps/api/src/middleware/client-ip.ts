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
 * Two things fix that. The address is resolved here, from the socket when no
 * proxy is trusted and from the furthest believable hop of the forwarded
 * chain when one is; and the header is then *overwritten* with that single
 * address, which is what makes the fix reach Better Auth. Better Auth reads
 * the client IP from headers alone and has no access to the socket, so
 * handing it a header this app has already vouched for is the only way to
 * give it a trustworthy address — and rewriting rather than appending means a
 * value the client supplied cannot survive to be read.
 *
 * `trustedProxies` is exact-match on the nearest hop rather than CIDR: a
 * deployment either terminates at a known load balancer or it does not, and
 * range matching here would be a second, worse copy of the one inside Better
 * Auth (`@better-auth/core/utils/ip`).
 *
 * @param trustedProxies - Addresses of the proxies this app sits behind.
 * Empty — the default — means no forwarded header is believed at all and the
 * socket address is used.
 * @returns A middleware handler that sets `clientIp` on the context.
 * @example
 * ```ts
 * app.use("*", clientIp(config.trustedProxies));
 * ```
 */
export function clientIp(trustedProxies: readonly string[]) {
  const trusted = new Set(trustedProxies);

  return createMiddleware<ClientIpEnv>(async (c, next) => {
    const address = resolve(c, trusted);
    c.set("clientIp", address);
    rewriteForwardedFor(c, address);
    await next();
  });
}

/**
 * The client's address: the furthest hop of the forwarded chain this app has
 * reason to believe when it is behind a trusted proxy, and the socket's peer
 * otherwise.
 */
function resolve(c: Context, trusted: Set<string>): string | undefined {
  const socket = socketAddress(c);

  if (trusted.size === 0) return socket;
  // The chain only means anything if the hop that wrote it is one we trust.
  if (!socket || !trusted.has(socket)) return socket;

  const chain = (c.req.header(FORWARDED_FOR) ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  // Right to left, past every trusted proxy: the first address that is not
  // one of ours is the furthest hop anything here can vouch for.
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const hop = chain[index] as string;
    if (!trusted.has(hop)) return hop;
  }
  return socket;
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
