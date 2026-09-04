import { roleMeets, type Role } from "@skill-registry/shared";
import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import type { Database } from "../db/client.js";
import { tokens, users, type UserRow } from "../db/schemas/index.js";
import { ForbiddenError, PasswordChangeRequiredError, UnauthenticatedError } from "../http/errors.js";
import type { AuthRegistry } from "./instance.js";
import { digestsMatch, hashTokenSecret } from "./token.js";

export interface AuthDependencies {
  db: Database;
  auth: AuthRegistry;
}

export type AuthVariables = { user: UserRow };

const BEARER_PREFIX = "Bearer ";

/**
 * Resolves a request to a User, from a session cookie or a Bearer Token, in
 * that order.
 *
 * @remarks
 * Authentication does not care which credential produced the request (spec,
 * "Access control"). Authorisation reads the role separately, from the row
 * this attaches to context — resolved from the database on every request,
 * never from the session or Token (ADR-0005) — so a Token grants no more than
 * its owner's current role, and a demotion or revocation lands on the next
 * request.
 *
 * @param deps - The database and Better Auth instance needed to resolve a credential.
 * @param options - `allowPendingPasswordChange` lets the request through while
 * the resolved User's `must_change_password` is set. Reserved for the two
 * routes that resolve it (docs/data-model.md).
 * @returns A Hono middleware handler that sets `user` in context on success.
 * @throws UnauthenticatedError if neither a session cookie nor a Bearer
 * Token resolves to a User.
 * @throws PasswordChangeRequiredError if the resolved User's
 * `must_change_password` is set and `options.allowPendingPasswordChange`
 * was not passed.
 * @example
 * ```ts
 * app.get("/users/me", requireAuth(deps, { allowPendingPasswordChange: true }), (c) => c.json(c.get("user")));
 * ```
 */
export function requireAuth(
  deps: AuthDependencies,
  options?: { allowPendingPasswordChange?: boolean },
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const user = (await resolveSessionUser(c, deps)) ?? (await resolveTokenUser(c, deps));
    if (!user) throw new UnauthenticatedError();
    if (user.must_change_password && !options?.allowPendingPasswordChange) {
      throw new PasswordChangeRequiredError();
    }
    c.set("user", user);
    await next();
  };
}

// Better Auth hands back the User the session belongs to, but the row is
// re-read rather than trusted from that payload: the role is resolved from
// Postgres on every request (ADR-0005).
async function resolveSessionUser(c: Context, deps: AuthDependencies): Promise<UserRow | null> {
  // `current`, not `fresh`: validating a session does not depend on which
  // Providers are configured (ADR-0019).
  const auth = await deps.auth.current();
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return null;

  const [user] = await deps.db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
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

  await deps.db.update(tokens).set({ last_used_at: new Date(), updated_at: new Date() }).where(eq(tokens.id, token.id));
  return user;
}

/**
 * Refuses a request whose User does not meet a minimum role.
 *
 * @remarks
 * Authorisation, kept separate from authentication: this reads the role off
 * the row `requireAuth` resolved for this request, so a demotion is refused on
 * the next request rather than whenever a credential expires (ADR-0005).
 * Always mounted after `requireAuth`, which is what puts the row on the
 * context. `roleMeets` is the same rank check the web interface uses to decide
 * what to offer a User, so the two cannot drift.
 *
 * @param minimum - The lowest role allowed through.
 * @returns A Hono middleware handler.
 * @throws ForbiddenError if the User's role ranks below `minimum`.
 * @example
 * ```ts
 * app.delete("/resources/:id", requireAuth(deps), requireRole("admin"), handler);
 * ```
 */
export function requireRole(minimum: Role): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const user = c.get("user");
    if (!roleMeets(user.role, minimum)) {
      throw new ForbiddenError(`Your role (${user.role}) does not allow this.`);
    }
    await next();
  };
}
