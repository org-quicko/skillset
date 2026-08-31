import { GitHubImportRequestSchema, GitHubSkillFilesSchema } from "@skill-registry/shared";
import type { Hono } from "hono";
import { requireAuth, requireRole, type AuthDependencies, type AuthVariables } from "../auth/middleware.js";
import { ValidationError } from "../http/errors.js";
import type { GitHubImportService } from "../services/github-import.js";

export type GitHubRouteDependencies = AuthDependencies & {
  githubImport: GitHubImportService;
};

/**
 * Registers `POST /github/skill-files`: reading a Skill folder out of a
 * GitHub repository the caller can see, private ones included.
 *
 * @remarks
 * Note what the body is, and is not. It carries `{ owner, repo, ref, path }`
 * and there is deliberately no URL field — the service builds every GitHub
 * request from these parts, so this route cannot be aimed at another host
 * (ADR-0020). The browser parses the pasted URL and sends the result; the
 * schema below re-validates it rather than trusting that it did.
 *
 * `writer`, not `reader`: this exists to publish, and reading a Skill needs no
 * identity at all (ADR-0013), so there is no reason for a reader to reach it.
 *
 * Public repositories do not come through here. The browser fetches those
 * anonymously and always has (ADR-0010) — this is the private path only, and
 * the fallback the interface reaches for when the anonymous one cannot see the
 * repository.
 *
 * @param app - The Hono app to register the route on.
 * @param deps - The auth dependencies and the GitHub import service.
 */
export function registerGitHubRoutes(app: Hono<{ Variables: AuthVariables }>, deps: GitHubRouteDependencies): void {
  app.post("/github/skill-files", requireAuth(deps), requireRole("writer"), async (c) => {
    const parsed = GitHubImportRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ValidationError(issue?.message ?? "Invalid repository location.", issue?.path.join("."));
    }

    const items = await deps.githubImport.fetchSkillFiles(c.get("user").id, parsed.data);
    return c.json(GitHubSkillFilesSchema.parse({ items }));
  });
}
