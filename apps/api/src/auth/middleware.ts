import type { Role } from "@skill-registry/shared";
import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { Database } from "../db/client.js";
import { tokens, users, type UserRow } from "../db/schema.js";
import { forbidden, unauthenticated } from "../http/errors.js";
import { SESSION_COOKIE_NAME, verifySession } from "./session.js";
import { digestsMatch, hashTokenSecret } from "./token.js";

export interface AuthDependencies {
  db: Database;
  jwtSecret: string;
}

export type AuthVariables = { user: UserRow };

const BEARER_PREFIX = "Bearer ";

/**
 * Authentication resolves a request to a User without regard to which
 * credential produced it (spec, "Access control"): a session cookie or a
 * Token's `Authorization: Bearer` header, tried in that order. Authorisation
 * reads the User's role separately, from the row this attaches to context —
 * resolved fresh on every request from the database, never from the session
 * or the Token itself (ADR-0005), so a Token grants no more than its owner's
 * *current* role and a demotion or revocation takes effect on the next
 * request.
 */
export function requireAuth(deps: AuthDependencies): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const user = (await resolveSessionUser(c, deps)) ?? (await resolveTokenUser(c, deps));
    if (!user) return unauthenticated(c);
    c.set("user", user);
    await next();
  };
}

async function resolveSessionUser(c: Context, deps: AuthDependencies): Promise<UserRow | null> {
  const cookie = getCookie(c, SESSION_COOKIE_NAME);
  if (!cookie) return null;

  const userId = await verifySession(cookie, deps.jwtSecret);
  if (!userId) return null;

  const [user] = await deps.db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user ?? null;
}

async function resolveTokenUser(c: Context, deps: AuthDependencies): Promise<UserRow | null> {
  const header = c.req.header("authorization");
  if (!header?.startsWith(BEARER_PREFIX)) return null;

  const secret = header.slice(BEARER_PREFIX.length).trim();
  if (!secret) return null;

  const digest = hashTokenSecret(secret);
  const [token] = await deps.db.select().from(tokens).where(eq(tokens.token_hash, digest)).limit(1);
  if (!token || !digestsMatch(token.token_hash, digest)) return null;

  const [user] = await deps.db.select().from(users).where(eq(users.id, token.user_id)).limit(1);
  if (!user) return null;

  await deps.db.update(tokens).set({ last_used_at: new Date() }).where(eq(tokens.id, token.id));
  return user;
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
