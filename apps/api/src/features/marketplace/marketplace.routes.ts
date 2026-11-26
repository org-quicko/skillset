import {
  MarketplaceSettingsSchema,
  MarketplaceSettingsUpdateSchema,
} from "@in-org-quicko/skillset-shared";
import { createRouter } from "../../lib/factory.js";
import { validate } from "../../lib/validator.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

/**
 * `/marketplace/settings`: the details of the Registry's Claude Code
 * marketplace — its name, owner, and description.
 *
 * @remarks
 * Admin-only. The marketplace itself is public at
 * `/.claude-plugin/marketplace.json` (ADR-0013, ADR-0030).
 */
export const marketplaceRoutes = createRouter()
  .use(requireAuth(), requireRole("admin"))
  .get("/settings", async (c) =>
    c.json(MarketplaceSettingsSchema.parse(await c.var.services.marketplace.getSettings())),
  )
  .put("/settings", validate("json", MarketplaceSettingsUpdateSchema), async (c) => {
    const settings = await c.var.services.marketplace.updateSettings(c.req.valid("json"));
    return c.json(MarketplaceSettingsSchema.parse(settings));
  });
