import { PublicIdentityProviderListSchema } from "@skillset/shared";
import { createRouter } from "../../lib/factory.js";

/**
 * `/auth`: the login page's Provider list, and everything else Better Auth owns
 * — signing in and out, the OAuth redirect, and its callback (ADR-0016).
 *
 * @remarks
 * `/providers` is registered before the catch-all so Better Auth, which knows
 * nothing about it, never sees it.
 */
export const authRoutes = createRouter()
  // Unauthenticated on purpose: a signed-out visitor reads this to know which
  // buttons to draw. Enabled Providers only, and no field that could carry a
  // secret (ADR-0013).
  .get("/providers", async (c) => {
    const items = await c.var.services.identityProviders.listEnabled();
    return c.json(PublicIdentityProviderListSchema.parse({ items }));
  })
  // `fresh`, not `current`: a Provider added moments ago has to be offered
  // here, so this is the one place that pays for the version check (ADR-0019).
  .all("/*", async (c) => {
    const auth = await c.var.services.auth.fresh();
    return auth.handler(c.req.raw);
  });
