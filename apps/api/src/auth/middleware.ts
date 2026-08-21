import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { Database } from "../db/client.js";
import { users, type UserRow } from "../db/schema.js";
import { unauthenticated } from "../http/errors.js";
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
