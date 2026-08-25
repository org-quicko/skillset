import { LoginSchema, UserSchema } from "@skill-registry/shared";
import type { Hono } from "hono";
import { requireAuth, type AuthVariables } from "../auth/middleware.js";
import { clearSessionCookie, setSessionCookie } from "../auth/session.js";
import { ValidationError } from "../http/errors.js";
import { login, type AuthServiceDependencies } from "../services/auth.js";

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

  app.post("/auth/logout", requireAuth(deps), async (c) => {
    clearSessionCookie(c);
    return c.body(null, 204);
  });
}
