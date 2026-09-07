import {
  IntegrationCreateSchema,
  IntegrationListSchema,
  IntegrationSchema,
  IntegrationUpdateSchema,
} from "@skill-registry/shared";
import type { Hono } from "hono";
import { requireAuth, requireRole, type AuthDependencies, type AuthVariables } from "../auth/middleware.js";
import { parseBody } from "../http/body.js";
import type { IntegrationsService } from "../services/integrations.js";

export type IntegrationRouteDependencies = AuthDependencies & {
  integrations: IntegrationsService;
};

/**
 * Registers the `/integrations` routes: an Admin's view of the Registry's
 * registrations with Git Providers, and creating or changing one (ADR-0024).
 *
 * @remarks
 * Admin-only throughout, and there is no unauthenticated counterpart. An
 * Identity Provider has one because it draws a button on the login page; an
 * Integration draws nothing, so no shape of it is ever public and no response
 * here is built from a row anyone but an Admin may see.
 *
 * Deleting one is refused (409) while a Connection still references it —
 * `connections.integration_id` does, under `ON DELETE RESTRICT` (ADR-0024) —
 * so removing an Integration can never silently strand a writer's grant.
 *
 * @param app - The Hono app to register the routes on.
 * @param deps - The auth dependencies and the Integrations service.
 */
export function registerIntegrationRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  deps: IntegrationRouteDependencies,
): void {
  app.get("/integrations", requireAuth(deps), requireRole("admin"), async (c) => {
    const items = await deps.integrations.list();
    return c.json(IntegrationListSchema.parse({ items }));
  });

  app.post("/integrations", requireAuth(deps), requireRole("admin"), async (c) => {
    const integration = await deps.integrations.create(await parseBody(c, IntegrationCreateSchema));
    return c.json(IntegrationSchema.parse(integration), 201);
  });

  app.patch("/integrations/:id", requireAuth(deps), requireRole("admin"), async (c) => {
    const input = await parseBody(c, IntegrationUpdateSchema);
    const integration = await deps.integrations.update(c.req.param("id"), input);
    return c.json(IntegrationSchema.parse(integration));
  });

  app.delete("/integrations/:id", requireAuth(deps), requireRole("admin"), async (c) => {
    await deps.integrations.delete(c.req.param("id"));
    return c.body(null, 204);
  });
}
