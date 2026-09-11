import {
  IntegrationCreateSchema,
  IntegrationListSchema,
  IntegrationSchema,
  IntegrationUpdateSchema,
} from "@in-org-quicko/skillset-shared";
import { createRouter } from "../../lib/factory.js";
import { uuidParam, validate } from "../../lib/validator.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { IntegrationNotFoundError } from "./integrations.errors.js";

const integrationId = uuidParam("id", () => new IntegrationNotFoundError());

/**
 * `/integrations`: an Admin's view of the Registry's registrations with Git
 * Providers, and creating, changing, or deleting one (ADR-0024).
 *
 * @remarks
 * Admin-only throughout, with no public counterpart: an Integration draws
 * nothing on the login page. Deleting one is refused (409) while a Connection
 * still references it, so removing an Integration never strands a writer's grant.
 */
export const integrationsRoutes = createRouter()
  .use(requireAuth(), requireRole("admin"))
  .get("/", async (c) => {
    const items = await c.var.services.integrations.list();
    return c.json(IntegrationListSchema.parse({ items }));
  })
  .post("/", validate("json", IntegrationCreateSchema), async (c) => {
    const integration = await c.var.services.integrations.create(c.req.valid("json"));
    return c.json(IntegrationSchema.parse(integration), 201);
  })
  .patch("/:id", integrationId, validate("json", IntegrationUpdateSchema), async (c) => {
    const integration = await c.var.services.integrations.update(c.req.valid("param").id, c.req.valid("json"));
    return c.json(IntegrationSchema.parse(integration));
  })
  .delete("/:id", integrationId, async (c) => {
    await c.var.services.integrations.delete(c.req.valid("param").id);
    return c.body(null, 204);
  });
