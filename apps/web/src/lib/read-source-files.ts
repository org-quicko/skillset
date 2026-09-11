import {
  discoverSkillFolders,
  SkillFilesSchema,
  SkillSourcesSchema,
  parseSkillSourceUrl,
  readSkillFolder,
  SkillFolderError,
  type SkillFile,
  type SkillFolderReason,
  type SkillSourceLocation,
} from "@in-org-quicko/skillset-shared";
import { ApiError, apiFetch } from "@/lib/api";

/**
 * The API's refusals that mean no token was sent, and so that the anonymous
 * path is still worth trying: the writer holds no Connection, or no Integration
 * is configured for this provider at all. Every other refusal came from the
 * writer's own grant and is theirs to act on — `app_not_installed` and
 * `connection_expired` in particular, which have remedies an anonymous retry
 * would only hide.
 */
const SENT_NO_TOKEN = new Set(["not_connected", "integration_not_configured"]);

/**
 * The walk's reasons, as sentences for a browser with no credential.
 *
 * @remarks
 * The API says something different for the same reasons, because it is talking
 * to a connected writer about their own grant. Here there is no grant to point
 * at — only what a public request could and could not see.
 *
 * `not_found` has no entry: it never reaches a reader. All it means is "not
 * public", which says nothing they can act on, so `fetchSkillSourceFiles`
 * surfaces the original refusal instead.
 */
const ANONYMOUS_MESSAGES: Record<Exclude<SkillFolderReason, "not_found">, string> = {
  unauthorized: "That request was refused, and Skillset can only see public projects for you.",
  rate_limited:
    "That request was rate-limited. Wait a bit and try again, or publish by uploading the folder directly.",
  request_failed: "That project host could not be reached. Try again, or publish by uploading the folder directly.",
  untrusted_download_host: "A file came back from an unexpected host, so it was not fetched.",
  empty_folder: "That folder is empty, or doesn't exist at that ref.",
  too_many_entries: "That folder holds more files than a Skill may contain.",
  uncompressed_too_large: "That folder is larger than a Skill may be.",
};

/**
 * `ANONYMOUS_MESSAGES`'s two folder-shaped sentences, reworded for a walk that
 * searches a project rather than reading one named folder — `empty_folder`
 * means no Skill was found anywhere in it, and `too_many_entries` means the
 * walk gave up rather than that one folder is oversized.
 */
const DISCOVERY_MESSAGES: Partial<Record<Exclude<SkillFolderReason, "not_found">, string>> = {
  empty_folder: "No Skill was found under that project or folder.",
  too_many_entries: "That project has more to search than a discovery walk will look through.",
};

/** The sentence for a reason a discovery walk refused on. */
function discoveryFailureMessage(reason: Exclude<SkillFolderReason, "not_found">): string {
  return DISCOVERY_MESSAGES[reason] ?? ANONYMOUS_MESSAGES[reason];
}

/**
 * Fetches a Skill's files from a Git Provider, given the already-parsed
 * location a writer's pasted URL named, or that a discovery walk found.
 *
 * @remarks
 * GitHub goes through the Registry, which attaches the writer's Connection
 * token to every request — public project or private one, it makes no
 * difference to the caller. Always sending the token is what makes a public
 * import behave the way a private one does: the same access, the same errors,
 * and thousands of requests an hour rather than the sixty an anonymous browser
 * gets (ADR-0024).
 *
 * The anonymous client-side fetch (ADR-0010) remains for the cases where no
 * token was sent at all: a writer with no Connection, and a Registry with no
 * GitHub Integration configured. It is also the *only* path for a provider with
 * no credentialed import — GitLab today — which is why an unsupported provider
 * skips the API rather than calling it and being refused.
 *
 * Either way the result is shaped exactly like `readDroppedFiles`'s — a path
 * relative to the published folder, not the project root — so it feeds the same
 * publishing pipeline unchanged.
 *
 * @param location - The provider, project, ref, and folder to read.
 * @returns The folder's files as `SkillFile[]`.
 * @throws Error, on the anonymous path, carrying the `ANONYMOUS_MESSAGES`
 * sentence for whatever the walk refused on.
 * @throws ApiError if the import fails under the writer's own grant, and —
 * when the anonymous path cannot see the project either — if no token was sent
 * because they hold no Connection or import is not configured.
 * @example
 * ```ts
 * const files = await fetchSkillFilesAt({
 *   provider: "github", project: "org/repo", ref: "main", path: "skills/code-review",
 * });
 * ```
 */
export async function fetchSkillFilesAt(location: SkillSourceLocation): Promise<SkillFile[]> {
  // Only GitHub has a credentialed path (ADR-0024). Anything else is public-only,
  // so there is nothing to try first.
  if (location.provider !== "github") return readAnonymously(location);

  try {
    return await fetchAsCaller(location);
  } catch (error) {
    if (!(error instanceof ApiError) || !SENT_NO_TOKEN.has(error.code)) throw error;

    try {
      return await readSkillFolder(location);
    } catch (anonymous) {
      if (!(anonymous instanceof SkillFolderError)) throw anonymous;
      // "Couldn't find it" from a credential-less browser means only that the
      // project is not public. Why no token was sent is the half the writer can
      // act on, and the two reasons have different remedies — connect GitHub,
      // or ask an Admin to configure the Integration. Any other anonymous
      // failure (a rate limit, an empty folder) does say something specific,
      // and keeps its own message.
      if (anonymous.reason === "not_found") throw error;
      throw new Error(ANONYMOUS_MESSAGES[anonymous.reason]);
    }
  }
}

/**
 * Fetches a Skill's files from a Git Provider, given the URL a writer pasted
 * on the publish screen.
 *
 * @remarks
 * Parses `url` and delegates to `fetchSkillFilesAt` — see there for how the
 * credentialed and anonymous paths are chosen between.
 *
 * @param url - A repository, project, or folder URL, as accepted by
 * `parseSkillSourceUrl`.
 * @returns The folder's files as `SkillFile[]`.
 * @throws Error if `url` isn't a recognised Git Provider URL (from
 * `parseSkillSourceUrl`), or whatever `fetchSkillFilesAt` throws.
 * @throws ApiError as `fetchSkillFilesAt` documents.
 * @example
 * ```ts
 * const files = await fetchSkillSourceFiles(
 *   "https://github.com/org/repo/tree/main/skills/code-review",
 * );
 * ```
 */
export async function fetchSkillSourceFiles(url: string): Promise<SkillFile[]> {
  return fetchSkillFilesAt(parseSkillSourceUrl(url));
}

/**
 * Finds every Skill folder under the location a writer's pasted URL names —
 * the discovery companion to `fetchSkillSourceFiles`, for a URL that may hold
 * more than one Skill (a repository root, or a folder several Skills sit
 * inside) rather than exactly one.
 *
 * @remarks
 * Chooses between the credentialed and anonymous walk exactly as
 * `fetchSkillFilesAt` does, and for the same reason (ADR-0024): a discovery
 * walk spends roughly one request per directory visited, so the sixty
 * requests an hour an anonymous browser gets exhausts far sooner than a
 * single-folder read would.
 *
 * @param url - A repository, project, or folder URL, as accepted by
 * `parseSkillSourceUrl`.
 * @returns Every Skill folder found, each ready to hand to `fetchSkillFilesAt`.
 * @throws Error if `url` isn't a recognised Git Provider URL, or, on the
 * anonymous path, carrying the `ANONYMOUS_MESSAGES` sentence for whatever the
 * walk refused on — including finding no Skill at all.
 * @throws ApiError if the walk fails under the writer's own grant, and — when
 * the anonymous path cannot see the project either — if no token was sent
 * because they hold no Connection or import is not configured.
 * @example
 * ```ts
 * const found = await discoverSkillSources("https://github.com/org/repo");
 * ```
 */
export async function discoverSkillSources(url: string): Promise<SkillSourceLocation[]> {
  const location = parseSkillSourceUrl(url);

  if (location.provider !== "github") return discoverAnonymously(location);

  try {
    const { items } = await apiFetch(`/imports/${location.provider}/skills`, SkillSourcesSchema, {
      method: "POST",
      body: JSON.stringify({ project: location.project, ref: location.ref, path: location.path }),
    });
    return items;
  } catch (error) {
    if (!(error instanceof ApiError) || !SENT_NO_TOKEN.has(error.code)) throw error;

    try {
      return await discoverSkillFolders(location);
    } catch (anonymous) {
      if (!(anonymous instanceof SkillFolderError)) throw anonymous;
      if (anonymous.reason === "not_found") throw error;
      throw new Error(discoveryFailureMessage(anonymous.reason));
    }
  }
}

/** `discoverSkillSources`'s anonymous path — see `readAnonymously`, its `fetchSkillFilesAt` counterpart. */
async function discoverAnonymously(location: SkillSourceLocation): Promise<SkillSourceLocation[]> {
  try {
    return await discoverSkillFolders(location);
  } catch (error) {
    if (!(error instanceof SkillFolderError)) throw error;
    if (error.reason === "not_found") {
      throw new Error(
        "That project or folder could not be found. Skillset can only read public projects from " +
          "this host, so a private one has to be published by uploading its folder.",
      );
    }
    throw new Error(discoveryFailureMessage(error.reason));
  }
}

/**
 * Reads a folder from the browser with no credential at all.
 *
 * @remarks
 * For a provider with no credentialed import there is no original refusal to
 * fall back to, so `not_found` has to say something itself — and the only thing
 * it can honestly say is that a public read did not find it.
 */
async function readAnonymously(location: SkillSourceLocation): Promise<SkillFile[]> {
  try {
    return await readSkillFolder(location);
  } catch (error) {
    if (!(error instanceof SkillFolderError)) throw error;
    if (error.reason === "not_found") {
      throw new Error(
        "That project or folder could not be found. Skillset can only read public projects from " +
          "this host, so a private one has to be published by uploading its folder.",
      );
    }
    throw new Error(ANONYMOUS_MESSAGES[error.reason]);
  }
}

/**
 * Asks the Registry to fetch the folder using the writer's own Connection
 * (ADR-0020, ADR-0024).
 *
 * @remarks
 * Sends parsed parts rather than the URL, because that is what the API accepts
 * — it builds the request itself so that it cannot be aimed anywhere else. The
 * provider travels in the path, not the body, so it cannot be overridden.
 *
 * @param location - The project, ref, and folder, already parsed.
 * @returns The folder's files, shaped exactly as the anonymous path returns them.
 * @throws ApiError if the writer holds no Connection, if no Integration is
 * configured, if their Connection cannot see the project, or if the import
 * fails.
 */
async function fetchAsCaller(location: SkillSourceLocation): Promise<SkillFile[]> {
  const { items } = await apiFetch(`/imports/${location.provider}/skill-files`, SkillFilesSchema, {
    method: "POST",
    body: JSON.stringify({ project: location.project, ref: location.ref, path: location.path }),
  });

  return items.map((item) => ({
    path: item.path,
    bytes: Uint8Array.from(atob(item.content_base64), (character) => character.charCodeAt(0)),
  }));
}
