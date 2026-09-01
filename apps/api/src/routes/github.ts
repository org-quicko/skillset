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
 * Public repositories come through here too. Every import by a writer signed
 * in with GitHub does, because the token is always worth sending: it is the
 * same access whether the repository is private or not, and it buys 5,000
 * requests an hour instead of the 60 an anonymous browser gets (ADR-0020).
 * The anonymous client-side fetch (ADR-0010) is now only the fallback for a
 * caller whose token the Registry will not send: one with no linked GitHub
 * account, or any caller at all while the GitHub Identity Provider is
 * disabled. Turning that Provider off withdraws the stored tokens along with
 * the login button, and this route refuses rather than spending them.
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

    const files = await deps.githubImport.fetchSkillFiles(c.get("user").id, parsed.data);
    // Base64 only because bytes have to cross JSON to reach the browser. The
    // service and the shared walk both deal in `SkillFile`, the same shape a
    // dropped folder produces; the encoding belongs at the wire, not inside them.
    const items = files.map((file) => ({
      path: file.path,
      content_base64: Buffer.from(file.bytes).toString("base64"),
    }));
    return c.json(GitHubSkillFilesSchema.parse({ items }));
  });
}
