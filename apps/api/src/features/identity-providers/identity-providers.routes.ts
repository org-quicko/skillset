import {
  IdentityProviderCreateSchema,
  IdentityProviderListSchema,
  IdentityProviderSchema,
  IdentityProviderUpdateSchema,
} from "@skillset/shared";
import { createRouter } from "../../lib/factory.js";
import { uuidParam, validate } from "../../lib/validator.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { IdentityProviderNotFoundError } from "./identity-providers.errors.js";

/**
 * `/identity-providers`: an Admin's view of every configured Provider, and
 * creating or changing one.
 *
 * @remarks
 * No delete route: disabling is how a Provider is taken out of service
 * (ADR-0015), since deleting one would lock out everyone who signs in through
 * it. The login page's list is `GET /auth/providers` instead, so a public
 * response is never shaped from a row holding a client secret.
 */
export const identityProvidersRoutes = createRouter()
  .use(requireAuth(), requireRole("admin"))
  .get("/", async (c) => {
    const providers = await c.var.services.identityProviders.list();
    return c.json(IdentityProviderListSchema.parse({ items: providers }));
  })
  .post("/", validate("json", IdentityProviderCreateSchema), async (c) => {
    const provider = await c.var.services.identityProviders.create(c.req.valid("json"));
    return c.json(IdentityProviderSchema.parse(provider), 201);
  })
  .patch(
    "/:id",
    uuidParam("id", () => new IdentityProviderNotFoundError()),
    validate("json", IdentityProviderUpdateSchema),
    async (c) => {
      const provider = await c.var.services.identityProviders.update(c.req.valid("param").id, c.req.valid("json"));
      return c.json(IdentityProviderSchema.parse(provider));
    },
  );
