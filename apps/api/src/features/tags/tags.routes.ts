import { TagListSchema, TagSchema, validateTagName } from "@in-org-quicko/sqillset-shared";
import { z } from "zod";
import { createRouter } from "../../lib/factory.js";
import { ruleSchema, uuidParam, validate } from "../../lib/validator.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { TagNotFoundError } from "./tags.errors.js";

const RenameTagBodySchema = z.object({ name: ruleSchema(validateTagName) });

/**
 * `/tags`: the whole catalog, and renaming a Tag.
 *
 * @remarks
 * Attaching, creating, and detaching Tags all happen through a Resource —
 * `PUT /resources/{id}/tags` — not here; this covers only the catalog itself
 * (ADR-0011).
 */
export const tagsRoutes = createRouter()
  // Unauthenticated: an anonymous visitor's Tag filter reads it (ADR-0013).
  .get("/", async (c) => c.json(TagListSchema.parse({ items: await c.var.services.tags.list() })))
  // `admin`, stricter than attaching a Tag: a rename reaches every Resource
  // carrying it (ADR-0011).
  .patch(
    "/:id",
    requireAuth(),
    requireRole("admin"),
    uuidParam("id", () => new TagNotFoundError()),
    validate("json", RenameTagBodySchema),
    async (c) => {
      const tag = await c.var.services.tags.rename(c.req.valid("param").id, c.req.valid("json").name);
      return c.json(TagSchema.parse(tag));
    },
  );
