import {
  GitHubFolderError,
  GitHubSkillFilesSchema,
  parseGitHubSkillUrl,
  readGitHubFolder,
  type GitHubFolderReason,
  type GitHubSkillLocation,
  type SkillFile,
} from "@skill-registry/shared";
import { ApiError, apiFetch } from "@/lib/api";

/**
 * The API's refusals that mean no GitHub token was sent, and so that the
 * anonymous path is still worth trying: the writer has no linked GitHub
 * account, or GitHub sign-in is turned off on this Registry entirely and the
 * Registry will not use a stored token (ADR-0020). Every other refusal came
 * from the writer's own GitHub access and is theirs to act on.
 */
const SENT_NO_TOKEN = new Set(["github_not_connected", "github_login_disabled"]);

/**
 * The walk's reasons, as sentences for a browser with no credential.
 *
 * @remarks
 * The API says something different for the same reasons, because it is talking
 * to someone signed in with GitHub about their own access. Here there is no
 * account to point at — only what a public request could and could not see.
 *
 * `not_found` has no entry: it never reaches a reader. All it means is "not
 * public", which says nothing they can act on, so `fetchGitHubSkillFiles`
 * surfaces the original refusal instead.
 */
const ANONYMOUS_MESSAGES: Record<Exclude<GitHubFolderReason, "not_found">, string> = {
  unauthorized: "GitHub refused that request, and this Registry can only see public repositories for you.",
  rate_limited:
    "GitHub rate-limited this request. Wait a bit and try again, or publish by uploading the folder directly.",
  request_failed: "GitHub could not be reached. Try again, or publish by uploading the folder directly.",
  untrusted_download_host: "GitHub returned a file from an unexpected host, so it was not fetched.",
  empty_folder: "That folder is empty, or doesn't exist at that ref.",
  too_many_entries: "That folder holds more files than a Skill may contain.",
  uncompressed_too_large: "That folder is larger than a Skill may be.",
};

/**
 * Fetches a Skill's files from GitHub, given the URL a writer pasted on the
 * publish screen.
 *
 * @remarks
 * The import goes through the Registry, which attaches the writer's own
 * GitHub token to every request (ADR-0020) — public repository or private
 * one, it makes no difference to the caller. Always sending the token is what
 * makes a public import behave the way a private one does: the same access,
 * the same errors, and 5,000 requests an hour rather than the 60 an anonymous
 * browser gets.
 *
 * The anonymous client-side fetch (docs/adr/0010) remains for the two cases
 * where no token was sent at all: a writer with no linked GitHub account, and
 * a Registry whose GitHub sign-in is turned off, which withdraws the use of
 * every stored token rather than only the login button. That path runs the
 * same `readGitHubFolder` the API does, minus the token — so a folder is read,
 * bounded, and refused identically whichever side reads it.
 *
 * Either way the result is shaped exactly like `readDroppedFiles`'s — a path
 * relative to the published folder, not the repository root — so it feeds the
 * same publishing pipeline unchanged.
 *
 * @param url - A GitHub repository or folder URL, as accepted by
 * `parseGitHubSkillUrl`.
 * @returns The folder's files as `SkillFile[]`.
 * @throws Error if `url` isn't a recognised GitHub repository or folder URL
 * (from `parseGitHubSkillUrl`), or, on the anonymous path, carrying the
 * `ANONYMOUS_MESSAGES` sentence for whatever the walk refused on.
 * @throws ApiError if the import fails under the writer's own GitHub access,
 * and — when the anonymous fallback cannot see the repository either — if no
 * token was sent because the account is unlinked or GitHub sign-in is off.
 * @example
 * const files = await fetchGitHubSkillFiles(
 *   "https://github.com/org/repo/tree/main/skills/code-review",
 * );
 */
export async function fetchGitHubSkillFiles(url: string): Promise<SkillFile[]> {
  const location = parseGitHubSkillUrl(url);

  try {
    return await fetchGitHubSkillFilesAsCaller(location);
  } catch (error) {
    if (!(error instanceof ApiError) || !SENT_NO_TOKEN.has(error.code)) throw error;

    try {
      return await readGitHubFolder(location);
    } catch (anonymous) {
      if (!(anonymous instanceof GitHubFolderError)) throw anonymous;
      // "Couldn't find it" from a credential-less browser means only that the
      // repository is not public. Why no token was sent is the half the writer
      // can act on, and the two reasons have opposite remedies — sign in with
      // GitHub, or ask an Admin to turn that login back on. Any other
      // anonymous failure (a rate limit, an empty folder) does say something
      // specific, and keeps its own message.
      if (anonymous.reason === "not_found") throw error;
      throw new Error(ANONYMOUS_MESSAGES[anonymous.reason]);
    }
  }
}

/**
 * Asks the Registry to fetch the folder using the signed-in writer's own
 * GitHub access (ADR-0020).
 *
 * @remarks
 * Sends the parsed parts rather than the URL, because that is what the API
 * accepts — it builds the GitHub request itself so that it cannot be aimed
 * anywhere else.
 *
 * @param location - The repository, ref, and folder, already parsed.
 * @returns The folder's files, shaped exactly as the anonymous path returns them.
 * @throws ApiError if the writer has no linked GitHub account, if GitHub
 * sign-in is disabled on this Registry, if they cannot see the repository, or
 * if the import fails.
 */
async function fetchGitHubSkillFilesAsCaller(location: GitHubSkillLocation): Promise<SkillFile[]> {
  const { items } = await apiFetch("/github/skill-files", GitHubSkillFilesSchema, {
    method: "POST",
    body: JSON.stringify(location),
  });

  return items.map((item) => ({
    path: item.path,
    bytes: Uint8Array.from(atob(item.content_base64), (character) => character.charCodeAt(0)),
  }));
}
