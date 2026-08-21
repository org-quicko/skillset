import { UserSchema } from "@skill-registry/shared";
import type { Hono } from "hono";
import { requireAuth, type AuthDependencies, type AuthVariables } from "../auth/middleware.js";

export function registerUsersRoutes(app: Hono<{ Variables: AuthVariables }>, deps: AuthDependencies): void {
  app.get("/users/me", requireAuth(deps), async (c) => {
    // The role on this row was resolved fresh for this request by
    // requireAuth, not read from the session token (ADR-0005).
    return c.json(UserSchema.parse(c.get("user")));
  });
}
