import { SkillPageSchema, SkillPublishedSchema, SkillSchema } from "@skill-registry/shared";
import type { Hono } from "hono";
import { requireAuth, requireRole, type AuthDependencies, type AuthVariables } from "../auth/middleware.js";
import {
  deleteSkill,
  getArtifactDownloadUrl,
  getSkill,
  listSkills,
  publishSkill,
  type SkillsServiceDependencies,
} from "../services/skills.js";

export interface SkillRouteDependencies extends AuthDependencies, SkillsServiceDependencies {}

export function registerSkillsRoutes(app: Hono<{ Variables: AuthVariables }>, deps: SkillRouteDependencies): void {
  app.get("/skills", requireAuth(deps), async (c) => {
    return c.json(SkillPageSchema.parse(await listSkills(deps, c.req.query("page"), c.req.query("q"))));
  });

  app.get("/skills/:name", requireAuth(deps), async (c) => {
    return c.json(SkillSchema.parse(await getSkill(deps, c.req.param("name"))));
  });

  app.put("/skills/:name", requireAuth(deps), requireRole("writer"), async (c) => {
    const publisher = c.get("user");
    const payload = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const result = await publishSkill(deps, publisher, c.req.param("name"), payload);
    return c.json(SkillPublishedSchema.parse(result));
  });

  app.delete("/skills/:name", requireAuth(deps), requireRole("admin"), async (c) => {
    await deleteSkill(deps, c.req.param("name"));
    return c.body(null, 204);
  });

  app.get("/skills/:name/artifact", requireAuth(deps), async (c) => {
    const url = await getArtifactDownloadUrl(deps, c.req.param("name"));
    return c.redirect(url, 302);
  });
}
