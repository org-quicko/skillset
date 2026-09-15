import { ARTIFACT_MAX_ENTRIES, ARTIFACT_MAX_UNCOMPRESSED_BYTES, isExcludedPath, type SkillFile } from "./artifact.js";
import { gitProviderConfig } from "./git-provider.js";
import type { GitHubContentsEntry } from "./github-contents-entry.js";
import type { GitLabTreeEntry } from "./gitlab-tree-entry.js";
import { SKILL_DISCOVERY_MAX_DEPTH } from "./skill-discovery.js";
import type { SkillFolderOptions } from "./skill-folder-options.js";
import type { SkillFolderReason } from "./skill-folder-reason.js";
import type { SkillFolderTransport } from "./skill-folder-transport.js";
import { SKILL_FILE_NAME } from "./skill-rules.js";
import type { SkillSourceLocation } from "./skill-source-location.js";

/**
 * Providers ask that a caller identify itself. Set unconditionally: a browser
 * treats `user-agent` as a forbidden header name and drops it, which is
 * harmless, and the server genuinely needs it.
 */
const USER_AGENT = "sqillset";

/** GitLab pages its tree listing; this is its maximum page size. */
const GITLAB_PAGE_SIZE = 100;

/**
 * Builds the transport both walks share.
 *
 * @remarks
 * `fetch` is bound, not a bare reference: called as `transport.fetch(...)`,
 * an unbound native `fetch` throws "Illegal invocation" in a real browser,
 * which no test using an injected stub would ever catch.
 */
function buildTransport(location: SkillSourceLocation, options: SkillFolderOptions): SkillFolderTransport {
  return {
    fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
    token: options.token,
    config: gitProviderConfig(location.provider),
  };
}

/** Thrown when a folder could not be read, carrying the specific `reason` a caller branches on. */
export class SkillFolderError extends Error {
  // Declared and assigned rather than written as parameter properties: the
  // web interface compiles shared code with erasableSyntaxOnly.
  readonly reason: SkillFolderReason;

  constructor(reason: SkillFolderReason, message: string) {
    super(message);
    this.name = "SkillFolderError";
    this.reason = reason;
  }
}

/**
 * Maps a non-2xx response to the reason it represents.
 *
 * @remarks
 * The rate-limit test runs before the general 401/403 branch, because a
 * rate-limited request answers 403 too and the two want opposite advice —
 * waiting versus re-authenticating. This applies to authenticated reads as
 * much as anonymous ones: a token is thousands of requests an hour, not
 * unlimited.
 *
 * Both header spellings are checked because the providers disagree: GitHub
 * sends `x-ratelimit-remaining`, GitLab `ratelimit-remaining`.
 *
 * @param transport - The provider the response came from, for its name.
 * @param res - The refused response.
 * @returns The error to throw.
 */
function failure(transport: SkillFolderTransport, res: Response): SkillFolderError {
  const name = transport.config.display_name;

  if (res.status === 404) {
    return new SkillFolderError("not_found", "That project or folder could not be found.");
  }

  const remaining = res.headers.get("x-ratelimit-remaining") ?? res.headers.get("ratelimit-remaining");
  if ((res.status === 403 || res.status === 429) && remaining === "0") {
    return new SkillFolderError("rate_limited", `${name} rate-limited this request.`);
  }
  if (res.status === 429) {
    return new SkillFolderError("rate_limited", `${name} rate-limited this request.`);
  }
  if (res.status === 401 || res.status === 403) {
    return new SkillFolderError("unauthorized", `${name} refused that request.`);
  }
  return new SkillFolderError("request_failed", `${name} request failed (${res.status}).`);
}

/**
 * Issues one request, with the caller's token when there is one.
 *
 * @remarks
 * `redirect: "manual"` on every path — a fixed host that follows a redirect is
 * not a fixed host. In a browser this yields an opaque-redirect response
 * (`status 0`, `ok` false), which lands in `failure` as `request_failed`:
 * refusing the redirect, which is the intent.
 */
function request(transport: SkillFolderTransport, url: string): Promise<Response> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": USER_AGENT,
  };
  if (transport.token) headers.authorization = `Bearer ${transport.token}`;
  return transport.fetch(url, { headers, redirect: "manual" });
}

/**
 * Accumulates a folder's files while holding it to the Artifact ceilings.
 *
 * @remarks
 * Shared by both walks because the two providers report sizes differently and
 * the ceiling must not. GitHub declares each file's size in its listing, so an
 * oversized folder is refused before a single byte is fetched. GitLab's tree
 * response carries no size at all, so there the total can only be known as the
 * bytes arrive — still bounded, just not as early. Passing the declared size
 * to both calls is what keeps a file from being counted twice.
 */
function collect(maxFiles: number, maxBytes: number) {
  const files: SkillFile[] = [];
  let totalBytes = 0;

  const chargeBytes = (bytes: number) => {
    totalBytes += bytes;
    if (totalBytes > maxBytes) {
      throw new SkillFolderError("uncompressed_too_large", "That folder is larger than a Skill may be.");
    }
  };

  return {
    files,
    /**
     * Refuses a listing that already names more files than a Skill may hold.
     *
     * @remarks
     * For a walk that lists before it fetches — GitLab's recursive tree — the
     * per-file `reserve` runs too late to stop an oversized project being
     * pulled into memory first. This is checked per page instead, so the walk
     * stops paging rather than accumulating.
     */
    assertCanHold(count: number): void {
      if (count > maxFiles) {
        throw new SkillFolderError(
          "too_many_entries",
          `That folder holds more than ${maxFiles} files, which is more than a Skill may contain.`,
        );
      }
    },
    /** Called before fetching, so a folder over a ceiling is refused ahead of the work. */
    reserve(declaredSize: number | undefined): void {
      if (files.length >= maxFiles) {
        throw new SkillFolderError(
          "too_many_entries",
          `That folder holds more than ${maxFiles} files, which is more than a Skill may contain.`,
        );
      }
      if (declaredSize !== undefined) chargeBytes(declaredSize);
    },
    /** Called with the bytes actually read, charging only what `reserve` could not. */
    add(path: string, bytes: Uint8Array, declaredSize: number | undefined): void {
      if (declaredSize === undefined) chargeBytes(bytes.byteLength);
      files.push({ path, bytes });
    },
  };
}

/** A fetched file's path, relative to the folder the location names rather than the project root. */
function relativePath(location: SkillSourceLocation, entryPath: string): string {
  return entryPath.slice(location.path.length).replace(/^\//, "");
}

/** GitLab addresses a project by its URL-encoded path. */
function projectId(location: SkillSourceLocation): string {
  return encodeURIComponent(location.project);
}

/**
 * Resolves a project's default branch, for a location naming no ref.
 *
 * @throws SkillFolderError if the provider refuses the request.
 */
async function defaultBranch(transport: SkillFolderTransport, location: SkillSourceLocation): Promise<string> {
  const { api_base } = transport.config;
  const url =
    location.provider === "github"
      ? `${api_base}/repos/${location.project}`
      : `${api_base}/projects/${projectId(location)}`;

  const res = await request(transport, url);
  if (!res.ok) throw failure(transport, res);
  return ((await res.json()) as { default_branch: string }).default_branch;
}

/**
 * Fetches one file's bytes from a host this module is willing to talk to.
 *
 * @remarks
 * A GitHub `download_url` comes from GitHub rather than from the caller, but it
 * is still checked against the host it is supposed to be: it is the one URL
 * here this module did not build itself (ADR-0020). GitLab has no such field —
 * its blobs are addressed on the API host — so there is nothing to distrust.
 *
 * @throws SkillFolderError with reason `untrusted_download_host` if a supplied
 * URL points anywhere but the provider's allowlisted raw host, or whatever
 * `failure` returns if the fetch is refused.
 */
async function download(transport: SkillFolderTransport, url: string, describe: string): Promise<Uint8Array> {
  const { raw_host, api_base } = transport.config;
  const allowed = raw_host ?? api_base;
  if (!url.startsWith(`${allowed}/`)) {
    throw new SkillFolderError(
      "untrusted_download_host",
      `Couldn't fetch "${describe}" from ${transport.config.display_name}.`,
    );
  }

  const res = await request(transport, url);
  if (!res.ok) throw failure(transport, res);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Walks a GitHub folder through the Contents API, one request per directory.
 *
 * @throws SkillFolderError as `readSkillFolder` documents.
 */
async function readGitHub(
  transport: SkillFolderTransport,
  location: SkillSourceLocation,
  ref: string,
  files: ReturnType<typeof collect>,
): Promise<void> {
  const { api_base } = transport.config;

  const contents = async (path: string): Promise<GitHubContentsEntry[]> => {
    const url = `${api_base}/repos/${location.project}/contents/${path}?ref=${encodeURIComponent(ref)}`;
    const res = await request(transport, url);
    if (!res.ok) throw failure(transport, res);

    // A single-file path answers with an object rather than an array.
    const body = (await res.json()) as GitHubContentsEntry | GitHubContentsEntry[];
    return Array.isArray(body) ? body : [body];
  };

  const walk = async (path: string): Promise<void> => {
    for (const entry of await contents(path)) {
      if (entry.type === "dir") {
        await walk(entry.path);
        continue;
      }
      // Symlinks and submodules are dropped, exactly as the publishing
      // pipeline already drops excluded paths.
      if (entry.type !== "file") continue;

      files.reserve(entry.size);
      const bytes = await download(transport, entry.download_url ?? "", entry.path);
      files.add(relativePath(location, entry.path), bytes, entry.size);
    }
  };

  await walk(location.path);
}

/**
 * Walks a GitLab folder through the repository-tree API.
 *
 * @remarks
 * One listing serves the whole folder — GitLab's tree endpoint takes
 * `recursive=true`, so there is no per-directory request as there is for
 * GitHub. It does page, though, and `x-next-page` is how it says so.
 *
 * @throws SkillFolderError as `readSkillFolder` documents.
 */
async function readGitLab(
  transport: SkillFolderTransport,
  location: SkillSourceLocation,
  ref: string,
  files: ReturnType<typeof collect>,
): Promise<void> {
  const { api_base } = transport.config;
  const base = `${api_base}/projects/${projectId(location)}/repository`;

  const entries: GitLabTreeEntry[] = [];
  let page = 1;
  while (page > 0) {
    const url =
      `${base}/tree?recursive=true&per_page=${GITLAB_PAGE_SIZE}&page=${page}` +
      `&ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(location.path)}`;
    const res = await request(transport, url);
    if (!res.ok) throw failure(transport, res);

    entries.push(...((await res.json()) as GitLabTreeEntry[]));
    // Checked per page, not per file: this walk lists everything before it
    // fetches anything, so waiting for `reserve` would mean holding an
    // oversized project in memory to discover it is oversized.
    files.assertCanHold(entries.filter((entry) => entry.type === "blob").length);

    // A page pointer that does not advance is a provider bug or a hostile
    // response, and following it is an unbounded loop either way.
    const next = Number(res.headers.get("x-next-page") ?? "");
    page = Number.isSafeInteger(next) && next > page ? next : 0;
  }

  for (const entry of entries) {
    // `tree` is a directory and `commit` a submodule; neither is a file.
    if (entry.type !== "blob") continue;

    files.reserve(undefined);
    const url = `${base}/files/${encodeURIComponent(entry.path)}/raw?ref=${encodeURIComponent(ref)}`;
    const bytes = await download(transport, url, entry.path);
    files.add(relativePath(location, entry.path), bytes, undefined);
  }
}

/**
 * Reads every file under a folder in a project at a Git Provider.
 *
 * @remarks
 * Shared by both paths that read a Skill folder: the API's server-side import,
 * which passes the calling writer's Connection token, and the browser's
 * anonymous path, which passes none (ADR-0010, ADR-0024). The token is the only
 * thing that differs between them — everything below applies equally either way.
 *
 * Every request is built from `location`'s validated parts and the provider's
 * pinned `api_base`, never from a URL a caller supplied, so this cannot be
 * pointed at another host. Returned paths are relative to `location.path`
 * rather than the project root — the same shape a dropped folder produces, so
 * the result feeds `buildSkillBundle` unchanged.
 *
 * The walk is serial rather than concurrent because the byte ceiling is a
 * running total: counting before fetching only refuses an oversized project
 * ahead of the work if the fetches are not already in flight.
 *
 * @param location - The provider, project, ref, and folder to read. A `null`
 * ref resolves the project's default branch.
 * @param options - The caller's token, a `fetch` to use, and the ceilings to
 * enforce. Every field is optional; the ceilings default to the limits an
 * Artifact is held to, so a caller cannot drop one by omission.
 * @returns The folder's files, at paths relative to `location.path`.
 * @throws SkillFolderError with reason `not_found`, `unauthorized`,
 * `rate_limited`, or `request_failed` if the provider refuses a request;
 * `untrusted_download_host` if it returns a file URL off the provider's
 * allowlisted host; `too_many_entries` or `uncompressed_too_large` if the
 * folder is larger than a Skill may be; and `empty_folder` if the folder holds
 * no files, or does not exist at that ref.
 * @throws Error if `location.provider` is not a known Git Provider, which is a
 * caller bug rather than a refusal — validate with `isGitProvider` first.
 * @example
 * ```ts
 * // As a connected writer, reaching private projects their Connection covers:
 * const files = await readSkillFolder(location, { token });
 * // Anonymously, reaching public projects only:
 * const files = await readSkillFolder(location);
 * ```
 */
export async function readSkillFolder(
  location: SkillSourceLocation,
  options: SkillFolderOptions = {},
): Promise<SkillFile[]> {
  const transport = buildTransport(location, options);
  const files = collect(
    options.maxFiles ?? ARTIFACT_MAX_ENTRIES,
    options.maxBytes ?? ARTIFACT_MAX_UNCOMPRESSED_BYTES,
  );
  const ref = location.ref ?? (await defaultBranch(transport, location));

  if (location.provider === "github") {
    await readGitHub(transport, location, ref, files);
  } else {
    await readGitLab(transport, location, ref, files);
  }

  if (files.files.length === 0) {
    throw new SkillFolderError("empty_folder", "That folder is empty, or doesn't exist at that ref.");
  }
  return files.files;
}

/** The last segment of a `/`-delimited path. */
function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

/**
 * A discovered Skill directory's path, relative to `location.path` — `""`
 * when the directory *is* `location.path`.
 */
function relativeToLocation(location: SkillSourceLocation, dir: string): string {
  if (dir === location.path) return "";
  return location.path === "" ? dir : dir.slice(location.path.length + 1);
}

/**
 * Walks a GitHub folder through the Contents API, looking for `SKILL.md`
 * rather than fetching bytes — one request per directory visited, same as
 * {@link readGitHub}, but a directory is never visited once it is found to
 * hold a Skill.
 *
 * @remarks
 * Bounded by directories visited, not just by depth: `SKILL_DISCOVERY_MAX_DEPTH`
 * caps how far down the walk looks, but a wide tree (many directories at the
 * same level) is otherwise unbounded in request count, unlike
 * {@link discoverGitLab}'s single listing, which `maxEntries` already caps.
 * One `contents` call is one request, so counting those is what keeps a
 * pathologically wide project from costing the caller (or, server-side, this
 * Registry) an unbounded number of upstream requests.
 *
 * @throws SkillFolderError as `discoverSkillFolders` documents.
 */
async function discoverGitHub(
  transport: SkillFolderTransport,
  location: SkillSourceLocation,
  ref: string,
  maxRequests: number,
): Promise<SkillSourceLocation[]> {
  const { api_base } = transport.config;
  let requests = 0;

  const contents = async (path: string): Promise<GitHubContentsEntry[]> => {
    requests += 1;
    if (requests > maxRequests) {
      throw new SkillFolderError(
        "too_many_entries",
        `That project holds more directories than a discovery walk will search.`,
      );
    }

    const url = `${api_base}/repos/${location.project}/contents/${path}?ref=${encodeURIComponent(ref)}`;
    const res = await request(transport, url);
    if (!res.ok) throw failure(transport, res);

    const body = (await res.json()) as GitHubContentsEntry | GitHubContentsEntry[];
    return Array.isArray(body) ? body : [body];
  };

  const found: SkillSourceLocation[] = [];

  const walk = async (path: string, depth: number): Promise<void> => {
    const entries = await contents(path);

    if (entries.some((entry) => entry.type === "file" && basename(entry.path) === SKILL_FILE_NAME)) {
      found.push({ ...location, path, ref });
      return;
    }
    if (depth >= SKILL_DISCOVERY_MAX_DEPTH) return;

    for (const entry of entries) {
      if (entry.type !== "dir" || isExcludedPath(basename(entry.path))) continue;
      await walk(entry.path, depth + 1);
    }
  };

  await walk(location.path, 0);
  return found;
}

/**
 * Finds every Skill directory in a GitLab project from one recursive tree
 * listing, rather than one request per directory as GitHub's walk needs.
 *
 * @remarks
 * The listing already scopes to `location.path` (its `path` query parameter),
 * so what is left here is purely local: depth, exclusion, and — because one
 * listing sees the whole tree at once rather than stopping descent as it
 * goes — dropping any match nested inside a shorter one after the fact.
 *
 * @throws SkillFolderError as `discoverSkillFolders` documents.
 */
async function discoverGitLab(
  transport: SkillFolderTransport,
  location: SkillSourceLocation,
  ref: string,
  maxEntries: number,
): Promise<SkillSourceLocation[]> {
  const { api_base } = transport.config;
  const base = `${api_base}/projects/${projectId(location)}/repository`;

  const entries: GitLabTreeEntry[] = [];
  let page = 1;
  while (page > 0) {
    const url =
      `${base}/tree?recursive=true&per_page=${GITLAB_PAGE_SIZE}&page=${page}` +
      `&ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(location.path)}`;
    const res = await request(transport, url);
    if (!res.ok) throw failure(transport, res);

    entries.push(...((await res.json()) as GitLabTreeEntry[]));
    if (entries.length > maxEntries) {
      throw new SkillFolderError(
        "too_many_entries",
        `That project holds more than ${maxEntries} entries, which is more than a discovery walk will search.`,
      );
    }

    const next = Number(res.headers.get("x-next-page") ?? "");
    page = Number.isSafeInteger(next) && next > page ? next : 0;
  }

  const skillDirs = entries
    .filter((entry) => entry.type === "blob" && basename(entry.path) === SKILL_FILE_NAME)
    .map((entry) => entry.path.slice(0, -(SKILL_FILE_NAME.length + 1)));

  const withinBounds = skillDirs
    .map((dir) => ({ dir, rel: relativeToLocation(location, dir) }))
    .filter(({ rel }) => {
      if (rel === "") return true;
      const segments = rel.split("/");
      return segments.length <= SKILL_DISCOVERY_MAX_DEPTH && !segments.some((segment) => isExcludedPath(segment));
    });

  // A directory nested inside a shorter match is dropped, so a Skill's own
  // supporting directories are never mistaken for Skills of their own — the
  // one thing GitHub's walk gets for free by never descending into a match,
  // and this walk has to restore after the fact.
  const kept: string[] = [];
  for (const { dir, rel } of withinBounds.sort((a, b) => a.rel.length - b.rel.length)) {
    const nested = kept.some((keptDir) => {
      const keptRel = relativeToLocation(location, keptDir);
      return rel !== keptRel && (keptRel === "" || rel.startsWith(`${keptRel}/`));
    });
    if (!nested) kept.push(dir);
  }

  return kept.map((dir) => ({ ...location, path: dir, ref }));
}

/**
 * Finds every Skill folder under a location in a project at a Git Provider.
 *
 * @remarks
 * A companion to {@link readSkillFolder} for a location that may hold more
 * than one Skill — a repository root, or any folder several Skills live
 * inside. A folder is a Skill the moment it holds a `SKILL.md`, and the walk
 * never descends into one once it has found it, so a Skill's own supporting
 * directories are never mistaken for Skills of their own. It looks up to
 * `SKILL_DISCOVERY_MAX_DEPTH` levels below `location.path`, and skips version
 * control metadata, dependency directories, and dotfile directories — the
 * same rule `isExcludedPath` already applies to a Skill's own files.
 *
 * If `location.path` itself holds a `SKILL.md`, that is the only result and
 * the walk does not run any further — the given folder already names exactly
 * one Skill.
 *
 * @param location - The provider, project, ref, and folder to search from. A
 * `null` ref resolves the project's default branch.
 * @param options - The caller's token and a `fetch` to use. `maxFiles` bounds
 * how much work the walk will do before giving up: tree entries examined on
 * GitLab, whose one-shot listing is not itself bounded by depth the way
 * GitHub's per-directory walk is, and directories visited (one request each)
 * on GitHub, whose depth limit alone does not bound a wide tree's request
 * count. Defaults to `ARTIFACT_MAX_ENTRIES` either way.
 * @returns Every Skill folder found, each as a `SkillSourceLocation` sharing
 * `location`'s provider and project, with `ref` resolved.
 * @throws SkillFolderError with reason `not_found`, `unauthorized`,
 * `rate_limited`, or `request_failed` if the provider refuses a request;
 * `too_many_entries` if the walk exceeds `maxFiles`' worth of work; or
 * `empty_folder` if no Skill is found under `location.path`.
 * @throws Error if `location.provider` is not a known Git Provider.
 * @example
 * ```ts
 * const found = await discoverSkillFolders({
 *   provider: "github", project: "acme/skills", ref: null, path: "",
 * });
 * // -> [{ provider: "github", project: "acme/skills", ref: "main", path: "code-review" }, ...]
 * ```
 */
export async function discoverSkillFolders(
  location: SkillSourceLocation,
  options: SkillFolderOptions = {},
): Promise<SkillSourceLocation[]> {
  const transport = buildTransport(location, options);
  const ref = location.ref ?? (await defaultBranch(transport, location));
  const maxEntries = options.maxFiles ?? ARTIFACT_MAX_ENTRIES;

  const found =
    location.provider === "github"
      ? await discoverGitHub(transport, location, ref, maxEntries)
      : await discoverGitLab(transport, location, ref, maxEntries);

  if (found.length === 0) {
    throw new SkillFolderError("empty_folder", "That folder is empty, or doesn't exist at that ref.");
  }
  return found;
}
