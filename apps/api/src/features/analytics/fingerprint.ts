import { createHash } from "node:crypto";

/**
 * A stable, non-reversible identifier for the client behind an Install, or
 * `undefined` when there is nothing to identify it by.
 *
 * @remarks
 * `GET /resources/:id/artifact` is unauthenticated (ADR-0013) and every hit
 * appended an event, so the install count — and the "most installed" sort
 * built on it — could be run up by anyone with a loop (ISSUE-23). This is
 * what the unique index dedupes on, one Install per client per Resource per
 * day.
 *
 * A hash, not the address itself: an install log is not a place to keep a
 * record of who fetched what, and a digest answers the only question the
 * count needs to ask ("have I already counted this client today?") without
 * keeping anything that identifies them. The address is salted with the
 * Resource's own id as well, so the same digest cannot be recognised across
 * Resources.
 *
 * Returns `undefined` when the address is unknown — behind a proxy this app
 * has not been told to trust (see `clientIp`), typically. Those Installs are
 * counted without deduplication rather than dropped: an uncounted Install is
 * a worse answer than a double-counted one, and the honest fix is to
 * configure `TRUSTED_PROXY_IPS`.
 *
 * @param resourceId - The Resource being installed.
 * @param clientIp - The client's address, as `clientIp` middleware resolved it.
 * @param userAgent - The request's `user-agent`, if any.
 * @returns A hex digest, or `undefined` if the client cannot be identified.
 * @example
 * ```ts
 * const fingerprint = installFingerprint(id, c.var.clientIp, c.req.header("user-agent"));
 * ```
 */
export function installFingerprint(
  resourceId: string,
  clientIp: string | undefined,
  userAgent: string | undefined,
): string | undefined {
  if (!clientIp) return undefined;
  return createHash("sha256").update(`${resourceId}|${clientIp}|${userAgent ?? ""}`).digest("hex");
}
