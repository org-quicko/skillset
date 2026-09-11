import {
  ArtifactManifestSchema,
  SkillDirectoryPageSchema,
  SkillDirectoryStatsSchema,
  SkillInstallTrendSchema,
  SkillPublishedSchema,
  SkillSchema,
  SkillTagsSchema,
} from "@skillset/shared";
import { createRouter } from "../../lib/factory.js";
import { uuidParam, validate } from "../../lib/validator.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { ARTIFACT_ARCHIVE_CONTENT_TYPE } from "../../storage/keys.js";
import type { InstallSource } from "../analytics/analytics.service.js";
import { installFingerprint } from "../analytics/fingerprint.js";
import { ResourceDirectoryQuerySchema } from "./resource-directory-query.js";
import { ResourceNotFoundError } from "./resources.errors.js";
import { PublishBodySchema, PublishParamsSchema, SetTagsBodySchema } from "./resources.schemas.js";

/**
 * Path segments shaped so no two routes below can match the same valid request,
 * whatever order they are registered in: an id is hex and hyphens (and a
 * uuidv7 always has digits), while a Kind is lowercase words (and every
 * registered Kind has letters outside a–f).
 */
const ID = ":id{[0-9a-fA-F-]+}";
const KIND = ":kind{[a-z]+(?:-[a-z]+)*}";

const resourceId = uuidParam("id", () => new ResourceNotFoundError());

/** Every value `?source=` on `GET /resources/:id/artifact` recognises. */
const INSTALL_SOURCES: readonly InstallSource[] = ["web", "cli", "mcp"];

function isInstallSource(value: string): value is InstallSource {
  return (INSTALL_SOURCES as readonly string[]).includes(value);
}

/**
 * The Content-Security-Policy every Artifact file is served under.
 *
 * @remarks
 * A publisher's file is served from this Registry's own origin, and several of
 * the types they can upload are ones a browser *executes* — HTML, SVG, and
 * any XML document, which runs `<script>` in the XHTML namespace. Displaying
 * them inline is the whole point of the preview, so the defence is what they
 * may do once displayed: no scripts, no plugins, nothing fetched from
 * anywhere else, and an opaque origin.
 *
 * Sent unconditionally rather than for the types known to be script-capable.
 * That allowlist was the bug behind ISSUE-1: `.xml` was never on it, so an
 * XHTML document uploaded as `x.xml` ran same-origin against an
 * unauthenticated read, and every script-capable type added to `MEDIA_TYPES`
 * later would have had to be remembered here too. The default is now
 * "contained", and only PDF is exempt.
 */
const ARTIFACT_FILE_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";

/**
 * Whether an Artifact file's `content-type` is exempt from
 * `ARTIFACT_FILE_CSP`.
 *
 * @remarks
 * Only PDF. It is rendered by the browser's own viewer, which
 * `default-src 'none'` and `sandbox` between them stop from loading at all,
 * and that viewer is a sandbox of its own with no access to this origin's
 * cookies or DOM.
 */
function isCspExempt(contentType: string): boolean {
  return contentType.startsWith("application/pdf");
}

/**
 * `/resources`: the catalog, reading a Resource and its Artifact, publishing,
 * deleting, and replacing a Resource's Tags (ADR-0026, ADR-0032).
 *
 * @remarks
 * Reads are unauthenticated and writes are role-gated (ADR-0013). Replacing
 * Tags is `writer`, the same bar as publishing: it affects only this Resource,
 * unlike renaming a Tag, which reaches every Resource carrying it.
 */
export const resourcesRoutes = createRouter()
  .get("/", validate("query", ResourceDirectoryQuerySchema), async (c) => {
    return c.json(SkillDirectoryPageSchema.parse(await c.var.services.resources.list(c.req.valid("query"))));
  })
  // The catalog's hero stats — unfiltered, unlike `total` on the list above.
  .get("/stats", async (c) => {
    return c.json(SkillDirectoryStatsSchema.parse(await c.var.services.resources.getStats()));
  })
  .get(`/${KIND}/by-name/:name`, async (c) => {
    return c.json(SkillSchema.parse(await c.var.services.resources.getByName(c.req.param("kind"), c.req.param("name"))));
  })
  .get(`/${ID}`, resourceId, async (c) => {
    return c.json(SkillSchema.parse(await c.var.services.resources.get(c.req.valid("param").id)));
  })
  // Fetched apart from the Resource itself, since most reads never need it.
  .get(`/${ID}/installs/trend`, resourceId, async (c) => {
    const points = await c.var.services.resources.getInstallTrend(c.req.valid("param").id);
    return c.json(SkillInstallTrendSchema.parse({ points }));
  })
  .put(
    `/${KIND}/:name`,
    requireAuth(),
    requireRole("writer"),
    validate("param", PublishParamsSchema),
    validate("json", PublishBodySchema),
    async (c) => {
      const result = await c.var.services.resources.publish(c.var.user, c.req.valid("param").name, c.req.valid("json"));
      return c.json(SkillPublishedSchema.parse(result));
    },
  )
  .put(
    `/${ID}/tags`,
    requireAuth(),
    requireRole("writer"),
    resourceId,
    validate("json", SetTagsBodySchema),
    async (c) => {
      const tags = await c.var.services.tags.setSkillTags(c.req.valid("param").id, c.req.valid("json").tags);
      return c.json(SkillTagsSchema.parse({ tags }));
    },
  )
  .delete(`/${ID}`, requireAuth(), requireRole("admin"), resourceId, async (c) => {
    await c.var.services.resources.remove(c.req.valid("param").id);
    return c.body(null, 204);
  })
  // Not an Install: listing what a Skill holds is not obtaining it (ADR-0028).
  .get(`/${ID}/files`, resourceId, async (c) => {
    const files = await c.var.services.resources.listArtifactFiles(c.req.valid("param").id);
    return c.json(ArtifactManifestSchema.parse({ files }));
  })
  // `{.+}` so the path keeps its slashes — `references/java.md` is one file.
  // The bytes are served rather than redirected to: the interface's preview
  // reads them with `fetch`, and a presigned storage URL would put that leg
  // cross-origin to a bucket whose CORS policy is not this app's to assume.
  // `content-type` comes from the path (ADR-0001: the API has never read these
  // bytes), and `nosniff` keeps a browser from guessing a different one.
  .get(`/${ID}/files/:path{.+}`, resourceId, async (c) => {
    const file = await c.var.services.resources.readArtifactFile(c.req.valid("param").id, c.req.param("path"));
    return c.body(file.stream, 200, {
      "content-type": file.contentType,
      "content-length": String(file.size),
      "x-content-type-options": "nosniff",
      ...(isCspExempt(file.contentType) ? {} : { "content-security-policy": ARTIFACT_FILE_CSP }),
    });
  })
  // The zip is assembled per request from the stored files (ADR-0032) and
  // records exactly one Install (ADR-0012, ADR-0028).
  .get(`/${ID}/artifact`, resourceId, async (c) => {
    // `?source=` identifies the caller: the web's Download button sends none,
    // `skillset add` sends `cli`. Anything missing or unrecognised counts as
    // `web` rather than refusing the download, so an old client keeps working.
    const rawSource = c.req.query("source");
    const source: InstallSource = rawSource && isInstallSource(rawSource) ? rawSource : "web";
    const id = c.req.valid("param").id;
    const { name, bytes } = await c.var.services.resources.buildArtifactArchive(
      id,
      source,
      installFingerprint(id, c.var.clientIp, c.req.header("user-agent")),
    );
    // `name` is constrained to SKILL_NAME_PATTERN, so it is safe in the header unescaped.
    return c.body(bytes as unknown as ArrayBuffer, 200, {
      "content-type": ARTIFACT_ARCHIVE_CONTENT_TYPE,
      "content-length": String(bytes.byteLength),
      "content-disposition": `attachment; filename="${name}.zip"`,
    });
  });
