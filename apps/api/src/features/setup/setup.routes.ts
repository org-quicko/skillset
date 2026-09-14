import { SetupInitSchema, SetupStateSchema, UserSchema } from "@in-org-quicko/skillset-shared";
import { createRouter } from "../../lib/factory.js";
import { validate } from "../../lib/validator.js";

/** `/setup`: whether the instance has its first Superadmin yet, and creating one. */
export const setupRoutes = createRouter()
  .get("/", async (c) => c.json(SetupStateSchema.parse(await c.var.services.setup.getState())))
  .post("/", validate("json", SetupInitSchema), async (c) => {
    const input = c.req.valid("json");
    const user = await c.var.services.setup.initializeSuperadmin(input);

    // The session comes from Better Auth's own sign-in (ADR-0016), so the first
    // login in an instance's life takes the same path as every one after it.
    const auth = await c.var.services.auth.current();
    const signedIn = await auth.api.signInEmail({
      body: { email: input.email, password: input.password },
      asResponse: true,
    });
    for (const cookie of signedIn.headers.getSetCookie()) {
      c.header("set-cookie", cookie, { append: true });
    }

    return c.json(UserSchema.parse(user), 201);
  });
