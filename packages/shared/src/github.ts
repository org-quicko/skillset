import { z } from "zod";

/**
 * Where a Skill's files live within a public GitHub repository, resolved
 * from a URL a writer pasted on the publish screen (ticket 20).
 */
export interface GitHubSkillLocation {
  owner: string;
  repo: string;
  /** `null` for a bare repository URL — the caller resolves the default branch. */
  ref: string | null;
  /** The folder's path within the repository, relative to its root. `""` for the repository root. */
  path: string;
}

const REPO_ROOT_PATTERN = /^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/;
const TREE_PATTERN = /^\/([^/]+)\/([^/]+?)(?:\.git)?\/tree\/([^/]+)(?:\/(.*))?$/;

/**
 * Parses a GitHub URL pasted on the publish screen into the repository and
 * folder it names.
 *
 * @remarks
 * Accepts two shapes, `https://github.com/` only: a bare repository URL
 * (`https://github.com/<owner>/<repo>`, with an optional trailing slash or
 * `.git` suffix), which resolves to the repository root with no ref chosen;
 * and GitHub's own folder-browsing URL
 * (`https://github.com/<owner>/<repo>/tree/<ref>[/<path...>]`), which names
 * an explicit ref and, optionally, a subdirectory. A ref containing `/` is
 * not supported — GitHub's URL shape is ambiguous between the ref and the
 * path in that case.
 *
 * @param url - The URL as pasted, untrimmed.
 * @returns The repository, ref, and path the URL names.
 * @throws Error if `url` is not `https://github.com/...`, or doesn't match
 * either accepted shape.
 * @example
 * Returns `{ owner: "org", repo: "repo", ref: "main", path: "skills/foo" }`:
 * ```
 * parseGitHubSkillUrl("https://github.com/org/repo/tree/main/skills/foo")
 * ```
 */
export function parseGitHubSkillUrl(url: string): GitHubSkillLocation {
  const invalid = () =>
    new Error(
      `"${url}" isn't a GitHub repository or folder URL. Expected ` +
        `https://github.com/<owner>/<repo> or https://github.com/<owner>/<repo>/tree/<ref>/<path>.`,
    );

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw invalid();
  }
  if (parsed.hostname !== "github.com") throw invalid();

  const tree = TREE_PATTERN.exec(parsed.pathname);
  if (tree) {
    const [, owner, repo, ref, path] = tree;
    if (!owner || !repo || !ref) throw invalid();
    return { owner, repo, ref, path: (path ?? "").replace(/\/+$/, "") };
  }

  const root = REPO_ROOT_PATTERN.exec(parsed.pathname);
  if (root) {
    const [, owner, repo] = root;
    if (!owner || !repo) throw invalid();
    return { owner, repo, ref: null, path: "" };
  }

  throw invalid();
}

/**
 * Owner, repository, and ref names, as this Registry will accept them.
 *
 * @remarks
 * Deliberately narrower than GitHub allows. These values are interpolated
 * into an `api.github.com` URL by the server (ADR-0020), so the pattern is
 * what stops a `/`, a `..`, or a `@` turning a repository path into a request
 * somewhere else. A ref containing `/` is already unsupported by
 * `parseGitHubSkillUrl`, so nothing legitimate is lost.
 */
export const GITHUB_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

const GitHubName = z.string().min(1).max(100).regex(GITHUB_NAME_PATTERN);

/**
 * A folder path within a repository: forward slashes only, no leading or
 * trailing slash, and no `.` or `..` segment — a traversal would otherwise
 * climb out of the repository path and address a different API route.
 */
const GitHubPath = z
  .string()
  .max(1024)
  .refine(
    (value) =>
      value === "" ||
      (!value.startsWith("/") &&
        !value.endsWith("/") &&
        value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")),
    { message: "Not a folder path within the repository." },
  );

/**
 * `POST /github/skill-files` request body — where to read a Skill from.
 *
 * @remarks
 * Parts, never a URL. The server builds the GitHub request from these fields
 * and will not follow anything a caller hands it, which is what keeps a
 * server-side fetch from being a request-forgery surface (ADR-0020). The
 * browser parses the pasted URL with `parseGitHubSkillUrl` and sends the
 * result.
 */
export const GitHubImportRequestSchema = z.object({
  owner: GitHubName,
  repo: GitHubName,
  /** `null` to use the repository's default branch. */
  ref: GitHubName.nullable(),
  path: GitHubPath,
});
export type GitHubImportRequest = z.infer<typeof GitHubImportRequestSchema>;

/** One fetched file. Base64 because bytes have to cross JSON to reach the browser. */
export const GitHubSkillFileSchema = z.object({
  path: z.string(),
  content_base64: z.string(),
});

/** `POST /github/skill-files` response — the folder's files, ready to publish. */
export const GitHubSkillFilesSchema = z.object({
  items: z.array(GitHubSkillFileSchema),
});
export type GitHubSkillFiles = z.infer<typeof GitHubSkillFilesSchema>;
