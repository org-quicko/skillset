import { SetupInitSchema, SetupStateSchema, UserSchema } from "@skill-registry/shared";
import type { Hono } from "hono";
import type { AuthVariables } from "../auth/middleware.js";
import { setSessionCookie } from "../auth/session.js";
import { ValidationError } from "../http/errors.js";
import { getSetupState, initializeSuperadmin, type SetupServiceDependencies } from "../services/setup.js";

/**
 * Registers the `/setup` routes: checking whether the instance has a first
 * superadmin yet, and creating one.
 *
 * @param app - The Hono app to register the routes on.
 * @param deps - The dependencies `getSetupState` and `initializeSuperadmin`
 * need.
 */
export function registerSetupRoutes(app: Hono<{ Variables: AuthVariables }>, deps: SetupServiceDependencies): void {
  app.get("/setup", async (c) => {
    return c.json(SetupStateSchema.parse(await getSetupState(deps)));
  });

  app.post("/setup", async (c) => {
    const parsed = SetupInitSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ValidationError(issue?.message ?? "Invalid request body.", String(issue?.path[0]));
    }

    const { user, token } = await initializeSuperadmin(deps, parsed.data);
    setSessionCookie(c, token);
    return c.json(UserSchema.parse(user), 201);
  });
}
