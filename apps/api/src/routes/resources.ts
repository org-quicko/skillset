import {
  ArtifactManifestSchema,
  SkillDirectoryPageSchema,
  SkillDirectoryStatsSchema,
  SkillInstallTrendSchema,
  SkillPublishedSchema,
  SkillSchema,
  SkillTagsSchema,
} from "@skillset/shared";
import type { Hono } from "hono";
import { requireAuth, requireRole, type AuthDependencies, type AuthVariables } from "../auth/middleware.js";
import { readJsonObject } from "../http/body.js";
import { parseResourceDirectoryQuery } from "../http/resource-directory-query.js";
import type { ResourcesService } from "../services/resources.js";
import { ARTIFACT_ARCHIVE_CONTENT_TYPE } from "../storage/keys.js";
import type { TagsService } from "../services/tags.js";

/**
 * The Content-Security-Policy one Artifact file is served under, or
 * `undefined` for a type that needs none.
 *
 * @remarks
 * A publisher's file is served from this Registry's own origin, and two of
 * the types they can upload are ones a browser *executes*: HTML, and SVG,
 * which carries `<script>` like any other document. Either one could
 * otherwise reach this app's cookies and storage. Displaying them inline is
 * the whole point of the preview, so the defence is what they may do once
 * displayed rather than whether they are: no scripts, no plugins, nothing
 * fetched from anywhere else, and an opaque origin.
 *
 * Everything else is left alone deliberately, and one case makes the reason
 * concrete: a PDF is rendered by the browser's own viewer, which
 * `default-src 'none'` and `sandbox` between them stop from loading at all.
 * A blanket policy would have traded a preview that works for a defence
 * against markdown.
 */
function contentSecurityPolicy(contentType: string): string | undefined {
  if (contentType.startsWith("text/html") || contentType.startsWith("image/svg+xml")) {
    return "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";
  }
  return undefined;
}

export type ResourceRouteDependencies = AuthDependencies & { resources: ResourcesService; tags: TagsService };

/**
 * Registers the `/resources` routes: list, read (by id or by `(kind, name)`),
 * the catalog's hero stats, publish, delete, replace a Resource's Tags,
 * browse an Artifact's files, read one of them, and download the whole
 * Artifact as a zip (ADR-0026, ADR-0032).
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
  // The GET routes below carry no `requireAuth` — reads are open to
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

  // Four path segments, so no ordering concern against the two- and
  // three-segment routes above — the Skill detail page's install trend
  // chart, fetched separately from the Skill itself since most reads never
  // need it.
  app.get("/resources/:id/installs/trend", async (c) => {
    const points = await deps.resources.getInstallTrend(c.req.param("id"));
    return c.json(SkillInstallTrendSchema.parse({ points }));
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

  // Three path segments with a literal last one, like `/artifact` below, so
  // neither needs ordering against the other. Not an Install: listing what a
  // Skill holds is not obtaining it (ADR-0028).
  app.get("/resources/:id/files", async (c) => {
    const files = await deps.resources.listArtifactFiles(c.req.param("id"));
    return c.json(ArtifactManifestSchema.parse({ files }));
  });

  // `{.+}` so the parameter swallows the slashes in a nested path —
  // `references/java.md` is one file, not two segments. The service validates
  // it before it becomes a storage key (ADR-0032).
  //
  // The bytes are served rather than redirected to, unlike an Artifact's
  // download used to be: the interface's preview reads these with `fetch`,
  // and a presigned storage URL would put that leg cross-origin to a bucket
  // whose CORS policy is not this app's to assume. `content-type` comes from
  // the path (ADR-0001: the API has never read these bytes), and
  // `X-Content-Type-Options` keeps a browser from sniffing its way to a
  // different one.
  app.get("/resources/:id/files/:path{.+}", async (c) => {
    const file = await deps.resources.readArtifactFile(c.req.param("id"), c.req.param("path"));
    const policy = contentSecurityPolicy(file.contentType);
    return c.body(file.bytes as unknown as ArrayBuffer, 200, {
      "content-type": file.contentType,
      "content-length": String(file.bytes.byteLength),
      "x-content-type-options": "nosniff",
      ...(policy ? { "content-security-policy": policy } : {}),
    });
  });

  // The zip is assembled per request from the Artifact's stored files
  // (ADR-0032, amending ADR-0001 on this read path only). Records exactly one
  // Install (ADR-0012, ADR-0028); `installs` elsewhere carries the usual
  // `refreshInstallCounts` lag.
  //
  // A plain top-level navigation gets the download, which is what the web's
  // Download control uses — no `Accept: application/json` representation any
  // more, since there is no presigned URL left to hand back.
  app.get("/resources/:id/artifact", async (c) => {
    const { name, bytes } = await deps.resources.buildArtifactArchive(c.req.param("id"));
    // `name` is already constrained to SKILL_NAME_PATTERN, so it is safe to
    // drop into the header unescaped.
    return c.body(bytes as unknown as ArrayBuffer, 200, {
      "content-type": ARTIFACT_ARCHIVE_CONTENT_TYPE,
      "content-length": String(bytes.byteLength),
      "content-disposition": `attachment; filename="${name}.zip"`,
    });
  });
}
