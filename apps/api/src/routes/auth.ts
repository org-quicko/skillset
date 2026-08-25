import { LoginSchema, UserSchema } from "@skill-registry/shared";
import type { Hono } from "hono";
import { requireAuth, type AuthVariables } from "../auth/middleware.js";
import { clearSessionCookie, setSessionCookie } from "../auth/session.js";
import { ValidationError } from "../http/errors.js";
import { login, type AuthServiceDependencies } from "../services/auth.js";

/**
 * Registers the `/auth/login` and `/auth/logout` routes.
 *
 * @param app - The Hono app to register the routes on.
 * @param deps - The dependencies `login` needs to verify credentials and
 * issue a session.
 */
export function registerAuthRoutes(app: Hono<{ Variables: AuthVariables }>, deps: AuthServiceDependencies): void {
  app.post("/auth/login", async (c) => {
    const parsed = LoginSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError("email and password are required.");
    }

    const { user, token } = await login(deps, parsed.data);
    setSessionCookie(c, token);
    return c.json(UserSchema.parse(user), 200);
  });

  app.post(
    "/auth/logout",
    // Ending a session is never blocked by a pending password change — the
    // must-change-password gate stops a User from doing anything else with
    // the session, not from giving it up (docs/data-model.md doesn't list
    // this among the routes it refuses, and refusing it would leave no way
    // to abandon a session started with a mistyped generated password).
    requireAuth(deps, { allowPendingPasswordChange: true }),
    async (c) => {
      clearSessionCookie(c);
      return c.body(null, 204);
    },
  );
}
