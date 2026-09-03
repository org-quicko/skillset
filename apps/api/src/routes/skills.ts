import {
  SkillDirectoryPageSchema,
  SkillDirectoryStatsSchema,
  SkillPublishedSchema,
  SkillSchema,
  SkillTagsSchema,
  SkillWithArtifactUrlSchema,
} from "@skill-registry/shared";
import type { Hono } from "hono";
import { requireAuth, requireRole, type AuthDependencies, type AuthVariables } from "../auth/middleware.js";
import { readJsonObject } from "../http/body.js";
import { parseSkillDirectoryQuery } from "../http/skill-directory-query.js";
import type { SkillsService } from "../services/skills.js";
import type { TagsService } from "../services/tags.js";

export type SkillRouteDependencies = AuthDependencies & { skills: SkillsService; tags: TagsService };

/**
 * Registers the `/skills` routes: list, read (by id or by name), the
 * directory's hero stats, publish, delete, replace a Skill's Tags, and
 * download an Artifact.
 *
 * @param app - The Hono app to register the routes on.
 * @param deps - The auth dependencies, the Skills service, and the Tags service.
 *
 * @remarks
 * The reads are unauthenticated and the writes are role-gated (ADR-0013).
 * `deps` still carries the auth dependencies because publish, delete, and Tag
 * replacement need them.
 */
export function registerSkillsRoutes(app: Hono<{ Variables: AuthVariables }>, deps: SkillRouteDependencies): void {
  // The five GET routes below carry no `requireAuth` — reads are open to
  // anyone who can reach the Registry (ADR-0013), and none of them reads the
  // User row. `SkillsService.list` documents query-parameter handling.
  app.get("/skills", async (c) => {
    return c.json(SkillDirectoryPageSchema.parse(await deps.skills.list(parseSkillDirectoryQuery(c))));
  });

  // Ahead of `/skills/:id` so its literal `by-name` segment wins the match —
  // the web's only way to resolve `/skills/<name>` to an id with nothing
  // already cached (getByName's docs explain why this isn't full-text
  // search).
  app.get("/skills/by-name/:name", async (c) => {
    return c.json(SkillSchema.parse(await deps.skills.getByName(c.req.param("name"))));
  });

  // Same reason as `by-name` above: its literal `stats` segment must be
  // registered ahead of `/skills/:id` to win the match. The Skill directory's
  // hero stats — unfiltered, unlike `total` on the list above.
  app.get("/skills/stats", async (c) => {
    return c.json(SkillDirectoryStatsSchema.parse(await deps.skills.getStats()));
  });

  app.get("/skills/:id", async (c) => {
    return c.json(SkillSchema.parse(await deps.skills.get(c.req.param("id"))));
  });

  app.put("/skills/:name", requireAuth(deps), requireRole("writer"), async (c) => {
    const publisher = c.get("user");
    const result = await deps.skills.publish(publisher, c.req.param("name"), await readJsonObject(c));
    return c.json(SkillPublishedSchema.parse(result));
  });

  app.delete("/skills/:id", requireAuth(deps), requireRole("admin"), async (c) => {
    await deps.skills.remove(c.req.param("id"));
    return c.body(null, 204);
  });

  // `writer`, the same bar as publish: attaching a Tag affects only this
  // Skill, unlike `PATCH /tags/:id`, which reaches every Skill carrying it and
  // is gated at `admin`.
  app.put("/skills/:id/tags", requireAuth(deps), requireRole("writer"), async (c) => {
    const body = await readJsonObject(c);
    const tags = await deps.tags.setSkillTags(c.req.param("id"), body.tags);
    return c.json(SkillTagsSchema.parse({ tags }));
  });

  // Redirects by default, so a plain link follows it unaided (ADR-0001: the
  // API never sees the bytes). Asking for JSON returns the Skill alongside the
  // same URL, which the web's Download control needs: a `fetch` cannot safely
  // follow the redirect, since that leg is cross-origin to storage whose CORS
  // policy is not this app's to assume.
  //
  // Both representations record the same one Install — this branch is
  // presentation only. `installs` carries the usual `refreshInstallCounts` lag
  // (ADR-0012).
  app.get("/skills/:id/artifact", async (c) => {
    const id = c.req.param("id");
    const url = await deps.skills.getArtifactDownloadUrl(id);
    if (c.req.header("accept")?.includes("application/json")) {
      const skill = await deps.skills.get(id);
      return c.json(SkillWithArtifactUrlSchema.parse({ ...skill, url }));
    }
    return c.redirect(url, 302);
  });
}
