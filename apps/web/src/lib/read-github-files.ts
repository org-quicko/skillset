import { parseGitHubSkillUrl, type SkillFile } from "@skill-registry/shared";

/** The subset of GitHub's Contents API entry shape this module reads. */
interface GitHubContentsEntry {
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  download_url: string | null;
}

/**
 * Thrown when a GitHub request fails for a reason worth telling the writer
 * apart from a generic network error — not found/private, or rate-limited.
 */
class GitHubFetchError extends Error {}

/**
 * Issues a GitHub API `GET` and parses its JSON body, translating the
 * response codes a writer is actually likely to hit into a plain sentence.
 *
 * @param url - The full `api.github.com` request URL.
 * @returns The parsed JSON body, typed as `T`.
 * @throws GitHubFetchError if the repository or path doesn't exist (404) or
 * anonymous requests are exhausted for the hour (403 with a zero
 * `x-ratelimit-remaining` header).
 * @throws Error for any other non-2xx response.
 */
async function githubJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/vnd.github+json" } });
  if (res.status === 404) {
    throw new GitHubFetchError(
      "Couldn't find that repository or folder. Only public repositories can be published from a URL.",
    );
  }
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    throw new GitHubFetchError(
      "GitHub rate-limited this request. Wait a bit and try again, or publish by uploading the folder directly.",
    );
  }
  if (!res.ok) {
    throw new GitHubFetchError(`GitHub request failed (${res.status}).`);
  }
  return (await res.json()) as T;
}

/**
 * Recursively fetches every file under a folder in a public GitHub
 * repository, at a given ref.
 *
 * @param owner - The repository owner.
 * @param repo - The repository name.
 * @param ref - The branch, tag, or commit to read from.
 * @param path - The folder's path within the repository (`""` for the root).
 * @param rootLength - `path`'s length, used to trim each entry's path down
 * to one relative to the folder being published rather than the repo root.
 * @returns Every file under `path`, as `SkillFile`s whose `path` is relative
 * to `path` itself. Directories are walked; symlinks and submodules are
 * dropped, the same way excluded paths already are elsewhere in the
 * publishing pipeline.
 * @throws GitHubFetchError per `githubJson`.
 */
async function walkGitHubFolder(
  owner: string,
  repo: string,
  ref: string,
  path: string,
  rootLength: number,
): Promise<SkillFile[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
  const entries = await githubJson<GitHubContentsEntry | GitHubContentsEntry[]>(url);
  const list = Array.isArray(entries) ? entries : [entries];

  const nested = await Promise.all(
    list.map(async (entry): Promise<SkillFile[]> => {
      if (entry.type === "dir") return walkGitHubFolder(owner, repo, ref, entry.path, rootLength);
      if (entry.type !== "file" || !entry.download_url) return [];

      const res = await fetch(entry.download_url);
      if (!res.ok) throw new GitHubFetchError(`Couldn't fetch "${entry.path}" from GitHub.`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      return [{ path: entry.path.slice(rootLength).replace(/^\//, ""), bytes }];
    }),
  );
  return nested.flat();
}

/**
 * Fetches a Skill's files straight from a public GitHub repository, given
 * the URL a writer pasted on the publish screen.
 *
 * @remarks
 * Fetches anonymously and client-side (docs/adr/0010) — only public
 * repositories are reachable. When the URL names no ref, the repository's
 * default branch is resolved first. The result is shaped exactly like
 * `readDroppedFiles`'s — a path relative to the published folder, not the
 * repository root — so it feeds the same publishing pipeline unchanged.
 *
 * @param url - A GitHub repository or folder URL, as accepted by
 * `parseGitHubSkillUrl`.
 * @returns The folder's files as `SkillFile[]`.
 * @throws Error if `url` isn't a recognised GitHub repository or folder URL
 * (from `parseGitHubSkillUrl`).
 * @throws GitHubFetchError if the repository or folder doesn't exist or
 * isn't public, if GitHub rate-limits the request, or if the folder is
 * empty.
 * @example
 * const files = await fetchGitHubSkillFiles(
 *   "https://github.com/org/repo/tree/main/skills/code-review",
 * );
 */
export async function fetchGitHubSkillFiles(url: string): Promise<SkillFile[]> {
  const location = parseGitHubSkillUrl(url);
  const ref =
    location.ref ??
    (await githubJson<{ default_branch: string }>(`https://api.github.com/repos/${location.owner}/${location.repo}`))
      .default_branch;

  const files = await walkGitHubFolder(location.owner, location.repo, ref, location.path, location.path.length);
  if (files.length === 0) {
    throw new GitHubFetchError("That folder is empty, or doesn't exist at that ref.");
  }
  return files;
}
