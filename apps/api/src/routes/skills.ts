import {
  SkillDirectoryPageSchema,
  SkillPublishedSchema,
  SkillSchema,
  SkillTagsSchema,
  SkillWithArtifactUrlSchema,
} from "@skill-registry/shared";
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
  // Tag ids, sort, and page size are ticket 23's additions — see
  // `listSkills`'s own docs for validation and defaulting.
  app.get("/skills", requireAuth(deps), async (c) => {
    return c.json(
      SkillDirectoryPageSchema.parse(
        await listSkills(deps, {
          page: c.req.query("page"),
          q: c.req.query("q"),
          tagIds: c.req.queries("tag_id"),
          sortBy: c.req.query("sort_by"),
          sortOrder: c.req.query("sort_order"),
          pageSize: c.req.query("page_size"),
        }),
      ),
    );
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

  // Redirects by default — a plain link follows this on its own (ADR-0001:
  // the API never sees the bytes, so there's nothing to stream itself). A
  // caller that asks for JSON instead gets the Skill back alongside the same
  // presigned URL: the web app's own Download control uses this so it can
  // write the Skill's state straight into its cache once it knows the
  // request actually succeeded, then navigate to `url` itself — a plain
  // `fetch` can't safely follow the redirect (that leg is cross-origin, to
  // storage, and its CORS policy isn't this app's to assume), but a
  // same-origin request for this representation never touches that leg at
  // all. Either representation records the same one Install — this branch is
  // presentation only. `installs` on that Skill reflects the last
  // `refreshInstallCounts` run, not necessarily this request's own Install
  // (ADR-0012), the same lag every other read of it has.
  app.get("/skills/:id/artifact", requireAuth(deps), async (c) => {
    const id = c.req.param("id");
    const url = await getArtifactDownloadUrl(deps, id);
    if (c.req.header("accept")?.includes("application/json")) {
      const skill = await getSkill(deps, id);
      return c.json(SkillWithArtifactUrlSchema.parse({ ...skill, url }));
    }
    return c.redirect(url, 302);
  });
}
