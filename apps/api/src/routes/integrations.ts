import {
  IntegrationCreateSchema,
  IntegrationListSchema,
  IntegrationSchema,
  IntegrationUpdateSchema,
} from "@skill-registry/shared";
import type { Hono } from "hono";
import { requireAuth, requireRole, type AuthDependencies, type AuthVariables } from "../auth/middleware.js";
import { ValidationError } from "../http/errors.js";
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
 * No delete route, matching `/identity-providers`. Deleting an Integration
 * would strand every Connection granted against it — `connections.provider`
 * references this table under `ON DELETE RESTRICT`, so the database would
 * refuse anyway — and there is no version of that failure worth exposing as a
 * route before there is a reason to remove one.
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
    const parsed = IntegrationCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ValidationError(issue?.message ?? "Invalid Integration.", issue?.path.join("."));
    }

    const integration = await deps.integrations.create(parsed.data);
    return c.json(IntegrationSchema.parse(integration), 201);
  });

  app.patch("/integrations/:provider", requireAuth(deps), requireRole("admin"), async (c) => {
    const parsed = IntegrationUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ValidationError(issue?.message ?? "Invalid Integration.", issue?.path.join("."));
    }

    const integration = await deps.integrations.update(c.req.param("provider"), parsed.data);
    return c.json(IntegrationSchema.parse(integration));
  });
}
