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
import { parseResourceDirectoryQuery } from "../http/resource-directory-query.js";
import type { ResourcesService } from "../services/resources.js";
import type { TagsService } from "../services/tags.js";

export type ResourceRouteDependencies = AuthDependencies & { resources: ResourcesService; tags: TagsService };

/**
 * Registers the `/resources` routes: list, read (by id or by `(kind, name)`),
 * the catalog's hero stats, publish, delete, replace a Resource's Tags, and
 * download an Artifact (ADR-0026).
 *
 * @param app - The Hono app to register the routes on.
 * @param deps - The auth dependencies, the Resources service, and the Tags service.
 *
 * @remarks
 * The reads are unauthenticated and the writes are role-gated (ADR-0013).
 * `deps` still carries the auth dependencies because publish, delete, and Tag
 * replacement need them.
 */
export function registerResourcesRoutes(app: Hono<{ Variables: AuthVariables }>, deps: ResourceRouteDependencies): void {
  // The five GET routes below carry no `requireAuth` — reads are open to
  // anyone who can reach the Registry (ADR-0013), and none of them reads the
  // User row. `ResourcesService.list` documents query-parameter handling.
  app.get("/resources", async (c) => {
    return c.json(SkillDirectoryPageSchema.parse(await deps.resources.list(parseResourceDirectoryQuery(c))));
  });

  // A different segment count from `/resources/:id` (four path segments
  // against two), so it needs no ordering relative to it — only `stats`
  // below shares `/resources/:id`'s shape.
  app.get("/resources/:kind/by-name/:name", async (c) => {
    return c.json(SkillSchema.parse(await deps.resources.getByName(c.req.param("kind"), c.req.param("name"))));
  });

  // Ahead of `/resources/:id` so its literal `stats` segment wins the match —
  // both are two path segments, so registration order is what decides it.
  // The catalog's hero stats — unfiltered, unlike `total` on the list above.
  app.get("/resources/stats", async (c) => {
    return c.json(SkillDirectoryStatsSchema.parse(await deps.resources.getStats()));
  });

  app.get("/resources/:id", async (c) => {
    return c.json(SkillSchema.parse(await deps.resources.get(c.req.param("id"))));
  });

  // Ahead of `/resources/:kind/:name` below: both are three path segments
  // (`/resources/<a>/<b>`), and Hono's router matches PUT routes in
  // registration order when two patterns are otherwise equally specific —
  // registering the publish route first would make every
  // `PUT /resources/{id}/tags` request parse as a publish attempt with
  // `kind={id}`, `name="tags"`, which `isKind` then rejects. `writer` is the
  // same bar as publish: attaching a Tag affects only this Resource, unlike
  // `PATCH /tags/:id`, which reaches every Resource carrying it and is gated
  // at `admin`.
  app.put("/resources/:id/tags", requireAuth(deps), requireRole("writer"), async (c) => {
    const body = await readJsonObject(c);
    const tags = await deps.tags.setSkillTags(c.req.param("id"), body.tags);
    return c.json(SkillTagsSchema.parse({ tags }));
  });

  // `kind` comes from the path and is validated in the service against
  // `KINDS` (ADR-0026) — an unregistered value is refused there with a
  // field-named validation error, not a 404.
  app.put("/resources/:kind/:name", requireAuth(deps), requireRole("writer"), async (c) => {
    const publisher = c.get("user");
    const result = await deps.resources.publish(
      publisher,
      c.req.param("kind"),
      c.req.param("name"),
      await readJsonObject(c),
    );
    return c.json(SkillPublishedSchema.parse(result));
  });

  app.delete("/resources/:id", requireAuth(deps), requireRole("admin"), async (c) => {
    await deps.resources.remove(c.req.param("id"));
    return c.body(null, 204);
  });

  // Redirects by default, so a plain link follows it unaided (ADR-0001: the
  // API never sees the bytes). Asking for JSON returns the Resource alongside
  // the same URL, which the web's Download control needs: a `fetch` cannot
  // safely follow the redirect, since that leg is cross-origin to storage
  // whose CORS policy is not this app's to assume.
  //
  // Both representations record the same one Install — this branch is
  // presentation only. `installs` carries the usual `refreshInstallCounts` lag
  // (ADR-0012).
  app.get("/resources/:id/artifact", async (c) => {
    const id = c.req.param("id");
    const url = await deps.resources.getArtifactDownloadUrl(id);
    if (c.req.header("accept")?.includes("application/json")) {
      const skill = await deps.resources.get(id);
      return c.json(SkillWithArtifactUrlSchema.parse({ ...skill, url }));
    }
    return c.redirect(url, 302);
  });
}
