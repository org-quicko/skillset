import { TagListSchema, TagSchema } from "@skillset/shared";
import type { Hono } from "hono";
import { requireAuth, requireRole, type AuthDependencies, type AuthVariables } from "../auth/middleware.js";
import { readJsonObject } from "../http/body.js";
import type { TagsService } from "../services/tags.js";

export type TagRouteDependencies = AuthDependencies & { tags: TagsService };

/**
 * Registers the `/tags` routes: list the whole catalog, and rename a Tag.
 *
 * @remarks
 * Attaching, creating, and detaching Tags all happen through a Resource —
 * `PUT /resources/{id}/tags` (`registerResourcesRoutes`) — not here. This
 * module only covers what operates on the catalog itself, independent of any
 * one Resource (ADR-0011).
 *
 * @param app - The Hono app to register the routes on.
 * @param deps - The auth dependencies and the Tags service.
 */
export function registerTagsRoutes(app: Hono<{ Variables: AuthVariables }>, deps: TagRouteDependencies): void {
  // No `requireAuth` — the catalog is what an anonymous visitor's Tag filter
  // reads, same as the Skill reads it filters (ADR-0013).
  app.get("/tags", async (c) => {
    return c.json(TagListSchema.parse({ items: await deps.tags.list() }));
  });

  // `admin` minimum, stricter than `PUT /resources/{id}/tags`'s `writer`: a
  // rename reaches every Resource that carries this Tag, not just the one
  // being edited (ADR-0011) — the same broader-blast-radius reasoning that
  // gates `DELETE /resources/{id}` at `admin`.
  app.patch("/tags/:id", requireAuth(deps), requireRole("admin"), async (c) => {
    const body = await readJsonObject(c);
    const tag = await deps.tags.rename(c.req.param("id"), body.name);
    return c.json(TagSchema.parse(tag));
  });
}
