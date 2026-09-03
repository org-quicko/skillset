import {
  IdentityProviderCreateSchema,
  IdentityProviderListSchema,
  IdentityProviderSchema,
  IdentityProviderUpdateSchema,
} from "@skill-registry/shared";
import type { Hono } from "hono";
import { requireAuth, requireRole, type AuthDependencies, type AuthVariables } from "../auth/middleware.js";
import { parseBody } from "../http/body.js";
import type { IdentityProvidersService } from "../services/identity-providers.js";

export type IdentityProviderRouteDependencies = AuthDependencies & {
  identityProviders: IdentityProvidersService;
};

/**
 * Registers the `/identity-providers` routes: an Admin's view of every
 * configured Provider, and creating or changing one.
 *
 * @remarks
 * No delete route. Disabling is how a Provider is taken out of service
 * (ADR-0015); deleting one would lock out everyone who signs in through it.
 *
 * The login page's list lives at `GET /auth/providers` instead. Separate paths
 * are what stop a public response ever being shaped from a row holding a
 * client secret.
 *
 * @param app - The Hono app to register the routes on.
 * @param deps - The auth dependencies and the Identity-Provider service.
 */
export function registerIdentityProviderRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  deps: IdentityProviderRouteDependencies,
): void {
  app.get("/identity-providers", requireAuth(deps), requireRole("admin"), async (c) => {
    const providers = await deps.identityProviders.list();
    return c.json(IdentityProviderListSchema.parse({ items: providers }));
  });

  app.post("/identity-providers", requireAuth(deps), requireRole("admin"), async (c) => {
    const provider = await deps.identityProviders.create(await parseBody(c, IdentityProviderCreateSchema));
    return c.json(IdentityProviderSchema.parse(provider), 201);
  });

  app.patch("/identity-providers/:id", requireAuth(deps), requireRole("admin"), async (c) => {
    const input = await parseBody(c, IdentityProviderUpdateSchema);
    const provider = await deps.identityProviders.update(c.req.param("id"), input);
    return c.json(IdentityProviderSchema.parse(provider));
  });
}
