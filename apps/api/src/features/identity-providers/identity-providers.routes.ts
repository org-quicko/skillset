import {
  IdentityProviderCreateSchema,
  IdentityProviderListSchema,
  IdentityProviderSchema,
  IdentityProviderUpdateSchema,
} from "@in-org-quicko/sqillset-shared";
import { createRouter } from "../../lib/factory.js";
import { uuidParam, validate } from "../../lib/validator.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { IdentityProviderNotFoundError } from "./identity-providers.errors.js";

/**
 * `/identity-providers`: the Superadmin's view of every configured Provider,
 * and creating or changing one.
 *
 * @remarks
 * No delete route: disabling is how a Provider is taken out of service
 * (ADR-0015), since deleting one would lock out everyone who signs in through
 * it. The login page's list is `GET /auth/providers` instead, so a public
 * response is never shaped from a row holding a client secret.
 *
 * `superadmin`, not `admin` (ISSUE-2). Configuring a Provider decides who can
 * obtain an account and, for an ungated one, who an external login may attach
 * to — which made this the shortest path from a compromised Admin account to
 * the Superadmin's. It is the one setting in the Registry that an Admin can
 * use to outrank themselves, so it sits with the role that already outranks
 * every Admin.
 */
export const identityProvidersRoutes = createRouter()
  .use(requireAuth(), requireRole("superadmin"))
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
