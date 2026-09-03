import { SetupInitSchema, SetupStateSchema, UserSchema } from "@skill-registry/shared";
import type { Hono } from "hono";
import type { AuthRegistry } from "../auth/instance.js";
import type { AuthVariables } from "../auth/middleware.js";
import { parseBody } from "../http/body.js";
import type { SetupService } from "../services/setup.js";

export interface SetupRouteDependencies {
  setup: SetupService;
  auth: AuthRegistry;
}

/**
 * Registers the `/setup` routes: checking whether the instance has a first
 * superadmin yet, and creating one.
 *
 * @param app - The Hono app to register the routes on.
 * @param deps - The Setup service, plus the auth registry that issues the
 * resulting session.
 */
export function registerSetupRoutes(app: Hono<{ Variables: AuthVariables }>, deps: SetupRouteDependencies): void {
  app.get("/setup", async (c) => {
    return c.json(SetupStateSchema.parse(await deps.setup.getState()));
  });

  app.post("/setup", async (c) => {
    const input = await parseBody(c, SetupInitSchema);
    const user = await deps.setup.initializeSuperadmin(input);

    // The session comes from Better Auth's own sign-in rather than from
    // anything written here (ADR-0016), so the first login in an instance's
    // life takes exactly the same path as every one after it — there is no
    // second way to mint a session that could drift from the real one.
    const auth = await deps.auth.current();
    const signedIn = await auth.api.signInEmail({
      body: { email: input.email, password: input.password },
      asResponse: true,
    });
    for (const cookie of signedIn.headers.getSetCookie()) {
      c.header("set-cookie", cookie, { append: true });
    }

    return c.json(UserSchema.parse(user), 201);
  });
}
