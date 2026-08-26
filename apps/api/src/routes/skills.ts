import { SkillPageSchema, SkillPublishedSchema, SkillSchema, SkillTagsSchema } from "@skill-registry/shared";
import type { Hono } from "hono";
import { requireAuth, requireRole, type AuthDependencies, type AuthVariables } from "../auth/middleware.js";
import {
  deleteSkill,
  getArtifactDownloadUrl,
  getSkill,
  getSkillByName,
  listSkills,
  publishSkill,
  type SkillsServiceDependencies,
} from "../services/skills.js";
import { setSkillTags, type TagsServiceDependencies } from "../services/tags.js";

export interface SkillRouteDependencies extends AuthDependencies, SkillsServiceDependencies, TagsServiceDependencies {}

/**
 * Registers the `/skills` routes: list, read (by id or by name), publish,
 * delete, replace a Skill's Tags, and download an Artifact.
 *
 * @param app - The Hono app to register the routes on.
 * @param deps - The auth, Skills-service, and Tags-service dependencies the routes need.
 */
export function registerSkillsRoutes(app: Hono<{ Variables: AuthVariables }>, deps: SkillRouteDependencies): void {
  app.get("/skills", requireAuth(deps), async (c) => {
    return c.json(SkillPageSchema.parse(await listSkills(deps, c.req.query("page"), c.req.query("q"))));
  });

  // Ahead of `/skills/:id` so its literal `by-name` segment wins the match —
  // the web's only way to resolve `/skills/<name>` to an id with nothing
  // already cached (getSkillByName's docs explain why this isn't full-text
  // search).
  app.get("/skills/by-name/:name", requireAuth(deps), async (c) => {
    return c.json(SkillSchema.parse(await getSkillByName(deps, c.req.param("name"))));
  });

  app.get("/skills/:id", requireAuth(deps), async (c) => {
    return c.json(SkillSchema.parse(await getSkill(deps, c.req.param("id"))));
  });

  app.put("/skills/:name", requireAuth(deps), requireRole("writer"), async (c) => {
    const publisher = c.get("user");
    const payload = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const result = await publishSkill(deps, publisher, c.req.param("name"), payload);
    return c.json(SkillPublishedSchema.parse(result));
  });

  app.delete("/skills/:id", requireAuth(deps), requireRole("admin"), async (c) => {
    await deleteSkill(deps, c.req.param("id"));
    return c.body(null, 204);
  });

  // A full replace of the Skill's Tags, by name (ADR-0011) — distinct from
  // publish, which never touches Tags at all. `writer` minimum, same bar as
  // publish itself: attaching an existing or brand-new Tag only affects the
  // one Skill being edited, unlike renaming a Tag (`PATCH /tags/:id`), which
  // reaches every Skill that carries it and is gated at `admin` instead.
  app.put("/skills/:id/tags", requireAuth(deps), requireRole("writer"), async (c) => {
    const payload = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const tags = await setSkillTags(deps, c.req.param("id"), payload?.tags);
    return c.json(SkillTagsSchema.parse({ tags }));
  });

  app.get("/skills/:id/artifact", requireAuth(deps), async (c) => {
    const url = await getArtifactDownloadUrl(deps, c.req.param("id"));
    return c.redirect(url, 302);
  });
}
