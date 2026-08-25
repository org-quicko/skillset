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
