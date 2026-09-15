import { roleMeets, type Role } from "@in-org-quicko/sqillset-shared";
import { createMiddleware } from "hono/factory";
import type { UserRow } from "../db/schemas/index.js";
import type { Credential } from "../features/auth/authenticator.js";
import { ForbiddenError, PasswordChangeRequiredError, UnauthenticatedError } from "../lib/errors.js";
import type { AppEnv } from "../lib/factory.js";

/**
 * What a route mounted after `requireAuth` can read: the User it is made as,
 * and what authenticated it.
 */
export type AuthenticatedEnv = { Variables: { user: UserRow; credential: Credential } };

/**
 * Refuses a request that carries no valid session cookie or Bearer Token, and
 * puts the User it was made as on the context.
 *
 * @remarks
 * A User whose generated password is still pending replacement is refused too,
 * except on the two routes that resolve that state (docs/data-model.md), which
 * pass `allowPendingPasswordChange`.
 *
 * @param options - `allowPendingPasswordChange` lets such a User through.
 * @returns A middleware handler that sets `user` and `credential` on the context.
 * @throws UnauthenticatedError if no credential resolves to a User.
 * @throws PasswordChangeRequiredError if the User's `must_change_password` is
 * set and `allowPendingPasswordChange` was not passed.
 * @example
 * ```ts
 * app.get("/me", requireAuth({ allowPendingPasswordChange: true }), (c) => c.json(c.var.user));
 * ```
 */
export function requireAuth(options?: { allowPendingPasswordChange?: boolean }) {
  return createMiddleware<AppEnv & AuthenticatedEnv>(async (c, next) => {
    const credential = await c.var.services.authenticator.resolve(c.req.raw.headers);
    if (!credential) throw new UnauthenticatedError();
    if (credential.user.must_change_password && !options?.allowPendingPasswordChange) {
      throw new PasswordChangeRequiredError();
    }
    c.set("user", credential.user);
    c.set("credential", credential);
    await next();
  });
}

/**
 * Refuses a request whose User ranks below a role.
 *
 * @remarks
 * Always mounted after `requireAuth`, which is what puts the User on the
 * context. `roleMeets` is the same rank check the web interface uses to decide
 * what to offer, so the two cannot drift.
 *
 * @param minimum - The lowest role allowed through.
 * @returns A middleware handler.
 * @throws ForbiddenError if the User's role ranks below `minimum`.
 * @example
 * ```ts
 * app.delete("/:id", requireAuth(), requireRole("admin"), handler);
 * ```
 */
export function requireRole(minimum: Role) {
  return createMiddleware<AuthenticatedEnv>(async (c, next) => {
    const { role } = c.var.user;
    if (!roleMeets(role, minimum)) {
      throw new ForbiddenError(`Your role (${role}) does not allow this.`);
    }
    await next();
  });
}
