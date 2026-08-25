import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";

export const SESSION_COOKIE_NAME = "SESSIONID";

// Cannot be revoked before expiry (ADR-0005), so kept short rather than
// matching how long a User might like to stay logged in.
const SESSION_TTL_SECONDS = 60 * 60 * 12;

/**
 * The session carries only the User's id — never their role — so a demotion
 * takes effect on the next request instead of waiting for re-login (ADR-0005).
 */
export function signSession(userId: string, jwtSecret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  return sign({ sub: userId, exp }, jwtSecret);
}

/** Returns the User id carried by a valid, unexpired session token, or null. */
export async function verifySession(token: string, jwtSecret: string): Promise<string | null> {
  try {
    const payload = await verify(token, jwtSecret, "HS256");
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * Sets the session cookie on the response: HTTP-only, secure, and scoped to
 * the whole site.
 *
 * @param c - The request context to set the cookie on.
 * @param token - The signed session token to store in the cookie.
 */
export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/**
 * Clears the session cookie, logging the current session out.
 *
 * @param c - The request context to clear the cookie on.
 */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
}
