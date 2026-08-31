import { createAuthClient } from "better-auth/react";

/**
 * The client for Better Auth's own endpoints (ADR-0016): signing in with a
 * password, signing out, and starting a login through an Identity Provider.
 *
 * @remarks
 * Deliberately not the way the interface learns *who* is signed in. That still
 * comes from `GET /users/me`, because the Registry's `User` carries a role and
 * Better Auth's session user does not — and the role has to be re-read from
 * the database on every request anyway (ADR-0005). Using this for credentials
 * and `/users/me` for identity keeps one source of truth for each.
 *
 * `baseURL` is left unset on purpose: the interface is served from the same
 * origin as the API, so the default relative base is correct in development
 * and in production alike, and there is no build-time URL to get wrong.
 */
export const authClient = createAuthClient({
  basePath: "/api/auth",
});
