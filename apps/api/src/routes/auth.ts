import { PublicIdentityProviderListSchema } from "@skillset/shared";
import type { Hono } from "hono";
import type { AuthRegistry } from "../auth/instance.js";
import type { AuthVariables } from "../auth/middleware.js";
import type { IdentityProvidersService } from "../services/identity-providers.js";

export interface AuthRouteDependencies {
  identityProviders: IdentityProvidersService;
  auth: AuthRegistry;
}

/**
 * Registers the authentication routes.
 *
 * @remarks
 * Two routes, one of them a catch-all. Signing in, signing out, the OAuth
 * redirect, and the callback all belong to Better Auth (ADR-0016).
 *
 * Registration order is load-bearing: Hono matches in order, so `/auth/providers`
 * must come first or the catch-all hands the login page's provider list to
 * Better Auth, which knows nothing about it.
 *
 * @param app - The Hono app to register the routes on.
 * @param deps - The auth registry and the Identity-Provider service.
 */
export function registerAuthRoutes(app: Hono<{ Variables: AuthVariables }>, deps: AuthRouteDependencies): void {
  // Unauthenticated, and deliberately so: this is what a signed-out visitor
  // reads to know which buttons to draw. Enabled Providers only, and never a
  // field that could carry a secret (ADR-0013).
  app.get("/auth/providers", async (c) => {
    const items = await deps.identityProviders.listEnabled();
    return c.json(PublicIdentityProviderListSchema.parse({ items }));
  });

  // `fresh`, not `current`: this is the one place a Provider added moments ago
  // has to be visible, so it is the one place that pays for the version check
  // (ADR-0019).
  app.all("/auth/*", async (c) => {
    const auth = await deps.auth.fresh();
    return auth.handler(c.req.raw);
  });
}
