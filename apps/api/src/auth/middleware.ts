import type { Role } from "@skill-registry/shared";
import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { Database } from "../db/client.js";
import { users, type UserRow } from "../db/schema.js";
import { forbidden, unauthenticated } from "../http/errors.js";
import { SESSION_COOKIE_NAME, verifySession } from "./session.js";

export interface AuthDependencies {
  db: Database;
  jwtSecret: string;
}

export type AuthVariables = { user: UserRow };

/**
 * Authentication resolves a request to a User without regard to which
 * credential produced it (spec, "Access control"); today that's only the
 * session cookie, and Token authentication (ticket 05) is a second resolver
 * added here, not a rewrite of this middleware. Authorisation reads the
 * User's role separately, from the row this attaches to context — resolved
 * fresh on every request, never from the token (ADR-0005).
 */
export function requireAuth(deps: AuthDependencies): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const user = await resolveUser(c, deps);
    if (!user) return unauthenticated(c);
    c.set("user", user);
    await next();
  };
}

async function resolveUser(c: Context, deps: AuthDependencies): Promise<UserRow | null> {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) return null;

  const userId = await verifySession(token, deps.jwtSecret);
  if (!userId) return null;

  const [user] = await deps.db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user ?? null;
}

// Roles are cumulative (spec, "Access control"): writer can do everything a
// reader can, admin everything a writer can, and so on. Rank order, not an
// allowlist, so a new top role (superadmin) is automatically included by
// every existing `requireRole` call without having to be added to each one.
const ROLE_RANK: Record<Role, number> = { reader: 0, writer: 1, admin: 2, superadmin: 3 };

/**
 * Authorisation, kept separate from authentication: this reads the role off
 * the User row `requireAuth` resolved for *this* request, so a demotion — or
 * a credential belonging to a demoted User — is refused on the next request
 * rather than whenever a credential expires (ADR-0005). Always mounted after
 * `requireAuth`, which is what puts the row on the context.
 */
export function requireRole(minimum: Role): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const user = c.get("user");
    if (ROLE_RANK[user.role] < ROLE_RANK[minimum]) {
      return forbidden(c, `Your role (${user.role}) does not allow this.`);
    }
    await next();
  };
}
