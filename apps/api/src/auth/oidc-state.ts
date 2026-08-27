import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

export const OIDC_FLOW_COOKIE_NAME = "OIDCFLOW";

// A login redirect that stalls at the provider should not leave a cookie
// behind for the rest of the session. Long enough to type a password and pass
// a second factor, short enough that an abandoned flow expires on its own.
const FLOW_TTL_SECONDS = 15 * 60;

/**
 * What a login carries from the moment it starts to the moment it comes back:
 * the nonce that ties an ID token to this browser, the Provider it was started
 * against, and where to land afterwards.
 *
 * @remarks
 * The same object goes two ways round — through the provider as `state`, and
 * into a cookie the provider never sees. The callback trusts the cookie and
 * checks the returned `state` against it, so a flow begun against one Provider
 * cannot be completed against another (ADR-0015).
 */
export interface OidcFlow {
  nonce: string;
  provider: string;
  destination: string;
}

/**
 * Encodes a flow as the opaque `state` value sent to the provider.
 *
 * @remarks
 * Deterministic: the same flow always encodes to the same string, which is
 * what lets the callback rebuild the expected `state` from its cookie rather
 * than trusting the one that came back over the network.
 *
 * @param flow - The nonce, Provider slug, and post-login destination.
 * @returns The base64url-encoded JSON, safe to put in a query string.
 * @example
 * ```ts
 * const state = encodeFlow({ nonce, provider: "google", destination: "/" });
 * ```
 */
export function encodeFlow(flow: OidcFlow): string {
  const json = JSON.stringify({
    nonce: flow.nonce,
    provider: flow.provider,
    destination: flow.destination,
  });
  return Buffer.from(json, "utf8").toString("base64url");
}

/**
 * Decodes a `state` value back into a flow.
 *
 * @remarks
 * Returns `null` rather than throwing for anything malformed — this parses
 * attacker-supplied input on every callback, and a bad value is an ordinary
 * failed login, not an exception.
 *
 * @param raw - The `state` parameter as it came back from the provider.
 * @returns The flow, or `null` if it is missing, not base64url, not JSON, or
 * not shaped like a flow.
 * @example
 * ```ts
 * const flow = decodeFlow(c.req.query("state"));
 * ```
 */
export function decodeFlow(raw: string | undefined | null): OidcFlow | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { nonce, provider, destination } = parsed as Record<string, unknown>;
    if (typeof nonce !== "string" || typeof provider !== "string" || typeof destination !== "string") {
      return null;
    }
    return { nonce, provider, destination };
  } catch {
    return null;
  }
}

/**
 * Stores the in-progress flow in a cookie the provider never sees.
 *
 * @remarks
 * `SameSite=Lax`, not `Strict` like the session cookie: the callback arrives
 * as a top-level navigation from the provider's origin, and a `Strict` cookie
 * would not be sent with it — leaving every external login to fail its nonce
 * check.
 *
 * @param c - The request context to set the cookie on.
 * @param flow - The flow to remember until the callback.
 */
export function setFlowCookie(c: Context, flow: OidcFlow): void {
  setCookie(c, OIDC_FLOW_COOKIE_NAME, encodeFlow(flow), {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: FLOW_TTL_SECONDS,
  });
}

/** Returns the flow this browser started, or `null` if there isn't a valid one. */
export function readFlowCookie(c: Context): OidcFlow | null {
  return decodeFlow(getCookie(c, OIDC_FLOW_COOKIE_NAME));
}

/** Clears the flow cookie — a flow is single-use, whether it succeeded or not. */
export function clearFlowCookie(c: Context): void {
  deleteCookie(c, OIDC_FLOW_COOKIE_NAME, { path: "/" });
}

/**
 * Narrows a requested post-login destination to somewhere inside this Registry.
 *
 * @remarks
 * The destination round-trips through the provider, so it is attacker-supplied
 * by the time it is used. Without this the callback is an open redirect: a
 * crafted link would send someone through a genuine Google login and land them
 * on an attacker's page carrying the appearance of having arrived from here.
 * Protocol-relative values (`//evil.example`) are rejected too — they are
 * absolute URLs that merely look like paths.
 *
 * @param raw - The requested destination, from a query parameter or `state`.
 * @returns The destination if it is a path within this Registry, otherwise `"/"`.
 * @example
 * ```ts
 * safeDestination("/skills/abc"); // "/skills/abc"
 * safeDestination("https://evil.example"); // "/"
 * ```
 */
export function safeDestination(raw: string | undefined | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  return raw;
}
