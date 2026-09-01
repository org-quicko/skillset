import { ARTIFACT_MAX_ENTRIES, ARTIFACT_MAX_UNCOMPRESSED_BYTES, type SkillFile } from "./artifact.js";
import type { GitHubSkillLocation } from "./github.js";

/** The only two hosts this module will ever talk to. */
const GITHUB_API = "https://api.github.com";
const GITHUB_RAW = "https://raw.githubusercontent.com";

/**
 * GitHub asks that a caller identify itself. Set unconditionally: a browser
 * treats `user-agent` as a forbidden header name and drops it, which is
 * harmless, and the server genuinely needs it.
 */
const USER_AGENT = "skill-registry";

/**
 * Why a folder could not be read.
 *
 * @remarks
 * `too_many_entries` and `uncompressed_too_large` deliberately reuse the
 * spellings `SkillRule` already gives the same two limits — the ceilings here
 * are the ones `buildArtifact` and `extractSkillFiles` enforce, and one
 * concept should not pick up a second name on the way through this module.
 *
 * Callers map these to their own wording: the API's sentences address a
 * signed-in writer acting on their own GitHub access, the browser's a reader
 * with no credential at all, and those are not interchangeable.
 */
export type GitHubFolderReason =
  | "not_found"
  | "unauthorized"
  | "rate_limited"
  | "request_failed"
  | "untrusted_download_host"
  | "empty_folder"
  | "too_many_entries"
  | "uncompressed_too_large";

/** Thrown when a folder could not be read, carrying the specific `reason` a caller branches on. */
export class GitHubFolderError extends Error {
  // Declared and assigned rather than written as parameter properties: the
  // web interface compiles shared code with erasableSyntaxOnly.
  readonly reason: GitHubFolderReason;

  constructor(reason: GitHubFolderReason, message: string) {
    super(message);
    this.name = "GitHubFolderError";
    this.reason = reason;
  }
}

export interface GitHubFolderOptions {
  /**
   * Sent as `Authorization: Bearer`. Omit for an anonymous read, which reaches
   * public repositories only and is rate-limited far harder (ADR-0020).
   */
  token?: string;
  /** Defaults to the global `fetch`. Tests pass a fake rather than reassigning the global. */
  fetch?: typeof fetch;
  /** Defaults to `ARTIFACT_MAX_ENTRIES`. */
  maxFiles?: number;
  /** Defaults to `ARTIFACT_MAX_UNCOMPRESSED_BYTES`. */
  maxBytes?: number;
}

/** The subset of GitHub's Contents API entry shape this module reads. */
interface ContentsEntry {
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size?: number;
  download_url: string | null;
}

/** How requests leave this module: a `fetch`, and the token to sign them with when there is one. */
interface Transport {
  fetch: typeof fetch;
  token: string | undefined;
}

/**
 * Maps a non-2xx response to the reason it represents.
 *
 * @remarks
 * The rate-limit test runs before the general 401/403 branch, because a
 * rate-limited request answers 403 too and the two want opposite advice —
 * waiting versus re-authenticating. This applies to authenticated reads as
 * much as anonymous ones: a token is 5,000 requests an hour, not unlimited.
 *
 * @param res - The refused response.
 * @returns The error to throw.
 */
function failure(res: Response): GitHubFolderError {
  if (res.status === 404) {
    return new GitHubFolderError("not_found", "That repository or folder could not be found.");
  }
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    return new GitHubFolderError("rate_limited", "GitHub rate-limited this request.");
  }
  if (res.status === 401 || res.status === 403) {
    return new GitHubFolderError("unauthorized", "GitHub refused that request.");
  }
  return new GitHubFolderError("request_failed", `GitHub request failed (${res.status}).`);
}

/**
 * Issues one request to GitHub, with the caller's token when there is one.
 *
 * @remarks
 * `redirect: "manual"` on both paths — a fixed host that follows a redirect is
 * not a fixed host. In a browser this yields an opaque-redirect response
 * (`status 0`, `ok` false), which lands in `failure` as `request_failed`:
 * refusing the redirect, which is the intent.
 */
function request(transport: Transport, url: string): Promise<Response> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": USER_AGENT,
  };
  if (transport.token) headers.authorization = `Bearer ${transport.token}`;
  return transport.fetch(url, { headers, redirect: "manual" });
}

/**
 * Resolves the repository's default branch, for a location naming no ref.
 *
 * @throws GitHubFolderError if GitHub refuses the request.
 */
async function defaultBranch(transport: Transport, location: GitHubSkillLocation): Promise<string> {
  const res = await request(transport, `${GITHUB_API}/repos/${location.owner}/${location.repo}`);
  if (!res.ok) throw failure(res);
  return ((await res.json()) as { default_branch: string }).default_branch;
}

/**
 * Lists one directory, normalising GitHub's single-entry response to an array.
 *
 * @throws GitHubFolderError if GitHub refuses the request.
 */
async function contents(
  transport: Transport,
  location: GitHubSkillLocation,
  path: string,
  ref: string,
): Promise<ContentsEntry[]> {
  const url =
    `${GITHUB_API}/repos/${location.owner}/${location.repo}/contents/${path}` + `?ref=${encodeURIComponent(ref)}`;
  const res = await request(transport, url);
  if (!res.ok) throw failure(res);

  const body = (await res.json()) as ContentsEntry | ContentsEntry[];
  return Array.isArray(body) ? body : [body];
}

/**
 * Fetches one file's bytes.
 *
 * @remarks
 * `download_url` comes from GitHub rather than from the caller, but it is
 * still checked against the host it is supposed to be: it is the one URL here
 * this module did not build itself (ADR-0020).
 *
 * @throws GitHubFolderError with reason `untrusted_download_host` if the URL
 * points anywhere but `raw.githubusercontent.com`, or whatever `failure`
 * returns if the fetch is refused.
 */
async function download(transport: Transport, entry: ContentsEntry): Promise<Uint8Array> {
  if (!entry.download_url?.startsWith(`${GITHUB_RAW}/`)) {
    throw new GitHubFolderError("untrusted_download_host", `Couldn't fetch "${entry.path}" from GitHub.`);
  }

  const res = await request(transport, entry.download_url);
  if (!res.ok) throw failure(res);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Reads every file under a folder in a GitHub repository.
 *
 * @remarks
 * Shared by both paths that read a Skill folder from GitHub: the API's
 * server-side import, which passes the calling writer's own OAuth token, and
 * the browser's anonymous fallback, which passes none (ADR-0020). The token is
 * the only thing that differs between them — everything below applies equally
 * either way.
 *
 * Every request is built from `location`'s validated parts, never from a URL a
 * caller supplied, so this cannot be pointed at another host. Symlinks and
 * submodules are dropped, exactly as the publishing pipeline already drops
 * excluded paths, and returned paths are relative to `location.path` rather
 * than the repository root — the same shape a dropped folder produces, so the
 * result feeds `buildSkillBundle` unchanged.
 *
 * The walk is serial rather than concurrent because the byte ceiling is a
 * running total: counting before fetching only refuses an oversized repository
 * ahead of the work if the fetches are not already in flight.
 *
 * @param location - The repository, ref, and folder to read. A `null` ref
 * resolves to the repository's default branch.
 * @param options - The caller's token, a `fetch` to use, and the ceilings to
 * enforce. Every field is optional; the ceilings default to the limits an
 * Artifact is held to, so a caller cannot drop one by omission.
 * @returns The folder's files, at paths relative to `location.path`.
 * @throws GitHubFolderError with reason `not_found`, `unauthorized`,
 * `rate_limited`, or `request_failed` if GitHub refuses a request;
 * `untrusted_download_host` if GitHub returns a `download_url` off
 * `raw.githubusercontent.com`; `too_many_entries` or `uncompressed_too_large`
 * if the folder is larger than a Skill may be; and `empty_folder` if the
 * folder holds no files, or does not exist at that ref.
 * @example
 * ```ts
 * // As the signed-in writer, reaching private repositories they can read:
 * const files = await readGitHubFolder(location, { token });
 * // Anonymously, reaching public repositories only:
 * const files = await readGitHubFolder(location);
 * ```
 */
export async function readGitHubFolder(
  location: GitHubSkillLocation,
  options: GitHubFolderOptions = {},
): Promise<SkillFile[]> {
  const transport: Transport = { fetch: options.fetch ?? globalThis.fetch, token: options.token };
  const maxFiles = options.maxFiles ?? ARTIFACT_MAX_ENTRIES;
  const maxBytes = options.maxBytes ?? ARTIFACT_MAX_UNCOMPRESSED_BYTES;
  const ref = location.ref ?? (await defaultBranch(transport, location));

  const files: SkillFile[] = [];
  let totalBytes = 0;

  const walk = async (path: string): Promise<void> => {
    for (const entry of await contents(transport, location, path, ref)) {
      if (entry.type === "dir") {
        await walk(entry.path);
        continue;
      }
      if (entry.type !== "file") continue;

      // Counted before fetching, so an oversized repository is refused rather
      // than pulled into memory first.
      if (files.length >= maxFiles) {
        throw new GitHubFolderError(
          "too_many_entries",
          `That folder holds more than ${maxFiles} files, which is more than a Skill may contain.`,
        );
      }
      totalBytes += entry.size ?? 0;
      if (totalBytes > maxBytes) {
        throw new GitHubFolderError("uncompressed_too_large", "That folder is larger than a Skill may be.");
      }

      files.push({
        path: entry.path.slice(location.path.length).replace(/^\//, ""),
        bytes: await download(transport, entry),
      });
    }
  };

  await walk(location.path);

  if (files.length === 0) {
    throw new GitHubFolderError("empty_folder", "That folder is empty, or doesn't exist at that ref.");
  }
  return files;
}
