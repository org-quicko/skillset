import {
  isGitProvider,
  RepositoryListSchema,
  SkillFilesSchema,
  SkillSourceLocationSchema,
  SkillSourcesSchema,
} from "@skillset/shared";
import { z } from "zod";
import { createRouter } from "../../lib/factory.js";
import { JsonObjectSchema, parseValue, validate } from "../../lib/validator.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

const GitProviderParamSchema = z.object({
  provider: z.string().refine(isGitProvider, { error: "Not a Git Provider this Registry reads from." }),
});

/**
 * `/imports`: reading a Skill folder, finding every Skill folder under a
 * location, and listing every repository the caller's Connection can see,
 * private ones included (ADR-0024).
 *
 * @remarks
 * Note what the body is, and is not. It carries `{ project, ref, path }` and
 * there is deliberately no URL field — the service builds every provider
 * request from these parts and the provider's pinned API base, so no route
 * here can be aimed at another host (ADR-0020). The browser parses the pasted
 * URL and sends the result; `SkillSourceLocationSchema` re-validates every
 * field rather than trusting that it did.
 *
 * The provider comes from the **path**, and is written over anything the body
 * claims. A caller must not be able to move an import to a different provider
 * by asking nicely in JSON.
 *
 * `writer`, not `reader`: this exists to publish, and reading a Skill needs no
 * identity at all (ADR-0013), so there is no reason for a reader to reach it.
 *
 * `/skills` takes the same body as `/skill-files` and answers with locations,
 * not files — a writer pastes a URL that may hold more than one Skill, picks
 * which of the ones found to publish, and each pick becomes its own
 * `/skill-files` request.
 *
 * Public projects come through here too, for a writer who holds a Connection —
 * the token buys thousands of requests an hour instead of the sixty an
 * anonymous browser gets. A writer with **no** Connection keeps the anonymous
 * client-side path (ADR-0010), which is what lets a Registry with no
 * Integration at all still import a public Skill.
 */
export const importsRoutes = createRouter()
  .use(requireAuth(), requireRole("writer"))
  .post("/:provider/skill-files", validate("json", JsonObjectSchema), async (c) => {
    // Spread first, provider second: the path wins.
    const location = parseValue({ ...c.req.valid("json"), provider: c.req.param("provider") }, SkillSourceLocationSchema);

    const files = await c.var.services.imports.fetchSkillFiles(c.var.user.id, location);
    const items = files.map((file) => ({
      path: file.path,
      content_base64: Buffer.from(file.bytes).toString("base64"),
    }));
    return c.json(SkillFilesSchema.parse({ items }));
  })
  .post("/:provider/skills", validate("json", JsonObjectSchema), async (c) => {
    // Spread first, provider second: the path wins.
    const location = parseValue({ ...c.req.valid("json"), provider: c.req.param("provider") }, SkillSourceLocationSchema);

    const items = await c.var.services.imports.listSkillFolders(c.var.user.id, location);
    return c.json(SkillSourcesSchema.parse({ items }));
  })
  // Refused here, before any lookup, so an unknown provider is this route's
  // 400 rather than a 409 that reads as "nobody configured this".
  .get("/:provider/repositories", validate("param", GitProviderParamSchema), async (c) => {
    const items = await c.var.services.imports.listRepositories(c.var.user.id, c.req.valid("param").provider);
    return c.json(RepositoryListSchema.parse({ items }));
  });
