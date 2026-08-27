import {
  IdentityProviderCreateSchema,
  IdentityProviderListSchema,
  IdentityProviderSchema,
  IdentityProviderUpdateSchema,
} from "@skill-registry/shared";
import type { Hono } from "hono";
import { requireAuth, requireRole, type AuthDependencies, type AuthVariables } from "../auth/middleware.js";
import { ValidationError } from "../http/errors.js";
import {
  createIdentityProvider,
  listIdentityProviders,
  updateIdentityProvider,
  type IdentityProvidersServiceDependencies,
} from "../services/identity-providers.js";

export interface IdentityProviderRouteDependencies
  extends AuthDependencies,
    IdentityProvidersServiceDependencies {}

/**
 * Registers the `/identity-providers` routes: an Admin's view of every
 * configured Provider, and creating or changing one.
 *
 * @remarks
 * There is deliberately no delete route. Disabling a Provider is how one is
 * taken out of service (ADR-0015) — deleting one is a config mistake rather
 * than a data-lifecycle event, and would lock out everyone who signs in
 * through it over a mistyped click.
 *
 * The login page's own list of Providers is not here: it is
 * `GET /auth/providers`, unauthenticated and carrying only what a button
 * needs. Keeping the two on separate paths is what stops a public response
 * ever being shaped from a row that holds a client secret.
 *
 * @param app - The Hono app to register the routes on.
 * @param deps - The auth and Identity-Provider-service dependencies.
 */
export function registerIdentityProviderRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  deps: IdentityProviderRouteDependencies,
): void {
  app.get("/identity-providers", requireAuth(deps), requireRole("admin"), async (c) => {
    const providers = await listIdentityProviders(deps);
    return c.json(IdentityProviderListSchema.parse({ items: providers }));
  });

  app.post("/identity-providers", requireAuth(deps), requireRole("admin"), async (c) => {
    const parsed = IdentityProviderCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ValidationError(issue?.message ?? "Invalid Identity Provider.", issue?.path.join("."));
    }

    const provider = await createIdentityProvider(deps, parsed.data);
    return c.json(IdentityProviderSchema.parse(provider), 201);
  });

  app.patch("/identity-providers/:id", requireAuth(deps), requireRole("admin"), async (c) => {
    const parsed = IdentityProviderUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ValidationError(issue?.message ?? "Invalid Identity Provider.", issue?.path.join("."));
    }

    const provider = await updateIdentityProvider(deps, c.req.param("id"), parsed.data);
    return c.json(IdentityProviderSchema.parse(provider));
  });
}
