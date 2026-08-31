import { TagListSchema, TagSchema } from "@skill-registry/shared";
import type { Hono } from "hono";
import { requireAuth, requireRole, type AuthDependencies, type AuthVariables } from "../auth/middleware.js";
import type { TagsService } from "../services/tags.js";

export type TagRouteDependencies = AuthDependencies & { tags: TagsService };

/**
 * Registers the `/tags` routes: list the whole catalog, and rename a Tag.
 *
 * @remarks
 * Attaching, creating, and detaching Tags all happen through a Skill —
 * `PUT /skills/{id}/tags` (`registerSkillsRoutes`) — not here. This module
 * only covers what operates on the catalog itself, independent of any one
 * Skill (ADR-0011).
 *
 * @param app - The Hono app to register the routes on.
 * @param deps - The auth dependencies and the Tags service.
 */
export function registerTagsRoutes(app: Hono<{ Variables: AuthVariables }>, deps: TagRouteDependencies): void {
  app.get("/tags", requireAuth(deps), async (c) => {
    return c.json(TagListSchema.parse({ items: await deps.tags.list() }));
  });

  // `admin` minimum, stricter than `PUT /skills/{id}/tags`'s `writer`: a
  // rename reaches every Skill that carries this Tag, not just the one being
  // edited (ADR-0011) — the same broader-blast-radius reasoning that gates
  // `DELETE /skills/{id}` at `admin`.
  app.patch("/tags/:id", requireAuth(deps), requireRole("admin"), async (c) => {
    const payload = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const tag = await deps.tags.rename(c.req.param("id"), payload?.name);
    return c.json(TagSchema.parse(tag));
  });
}
