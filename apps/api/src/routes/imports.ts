import {
  isGitProvider,
  RepositoryListSchema,
  SkillFilesSchema,
  SkillSourceLocationSchema,
  SkillSourcesSchema,
} from "@skillset/shared";
import type { Hono } from "hono";
import { requireAuth, requireRole, type AuthDependencies, type AuthVariables } from "../auth/middleware.js";
import { parseValue, readJsonObject } from "../http/body.js";
import { ValidationError } from "../http/errors.js";
import type { ImportsService } from "../services/imports.js";

export type ImportRouteDependencies = AuthDependencies & {
  imports: ImportsService;
};

/**
 * Registers `POST /imports/:provider/skill-files`, `POST /imports/:provider/skills`, and
 * `GET /imports/:provider/repositories`: reading a Skill folder, finding every Skill folder
 * under a location, and listing every repository the caller's Connection can see, private
 * ones included (ADR-0024).
 *
 * @remarks
 * Note what the body is, and is not. It carries `{ project, ref, path }` and
 * there is deliberately no URL field — the service builds every provider
 * request from these parts and the provider's pinned API base, so this route
 * cannot be aimed at another host (ADR-0020). The browser parses the pasted URL
 * and sends the result; the schema below re-validates every field rather than
 * trusting that it did.
 *
 * The provider comes from the **path**, and is written over anything the body
 * claims. A caller must not be able to move an import to a different provider
 * by asking nicely in JSON.
 *
 * `writer`, not `reader`: this exists to publish, and reading a Skill needs no
 * identity at all (ADR-0013), so there is no reason for a reader to reach it.
 *
 * `/skills` takes the same body shape and answers with locations, not files —
 * a writer pastes a URL that may hold more than one Skill, picks which of the
 * ones found to publish, and each pick becomes its own `/skill-files` request.
 * It shares every precondition and diagnosis `/skill-files` has, since both
 * routes are backed by the same Connection and the same walk.
 *
 * `/repositories` takes no body at all — there is nothing a caller could name
 * that would move it to another host, since it walks every installation the
 * caller's Connection already sees rather than reading one project a caller
 * points at.
 *
 * Public projects come through here too, for a writer who holds a Connection —
 * the token is worth sending either way, since it is the same access and it
 * buys thousands of requests an hour instead of the sixty an anonymous browser
 * gets. A writer with **no** Connection keeps the anonymous client-side path
 * (ADR-0010), which is what lets a Registry with no Integration at all still
 * import a public Skill.
 *
 * @param app - The Hono app to register the route on.
 * @param deps - The auth dependencies and the Imports service.
 */
export function registerImportRoutes(app: Hono<{ Variables: AuthVariables }>, deps: ImportRouteDependencies): void {
  app.post("/imports/:provider/skill-files", requireAuth(deps), requireRole("writer"), async (c) => {
    // Spread first, provider second: the path wins.
    const location = parseValue(
      { ...(await readJsonObject(c)), provider: c.req.param("provider") },
      SkillSourceLocationSchema,
    );

    const files = await deps.imports.fetchSkillFiles(c.get("user").id, location);
    const items = files.map((file) => ({
      path: file.path,
      content_base64: Buffer.from(file.bytes).toString("base64"),
    }));
    return c.json(SkillFilesSchema.parse({ items }));
  });

  app.post("/imports/:provider/skills", requireAuth(deps), requireRole("writer"), async (c) => {
    // Spread first, provider second: the path wins.
    const location = parseValue(
      { ...(await readJsonObject(c)), provider: c.req.param("provider") },
      SkillSourceLocationSchema,
    );

    const items = await deps.imports.listSkillFolders(c.get("user").id, location);
    return c.json(SkillSourcesSchema.parse({ items }));
  });

  app.get("/imports/:provider/repositories", requireAuth(deps), requireRole("writer"), async (c) => {
    const provider = c.req.param("provider");
    // No body to carry a schema's own refinement, unlike the two routes above —
    // checked directly so an unknown provider is this route's 400, not a 409
    // that reads as "nobody configured this" further down.
    if (!isGitProvider(provider)) throw new ValidationError("Not a Git Provider this Registry reads from.");

    const items = await deps.imports.listRepositories(c.get("user").id, provider);
    return c.json(RepositoryListSchema.parse({ items }));
  });
}
