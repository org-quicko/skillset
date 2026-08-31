import {
  ARTIFACT_MAX_ENTRIES,
  ARTIFACT_MAX_UNCOMPRESSED_BYTES,
  type GitHubImportRequest,
} from "@skill-registry/shared";
import { symmetricDecrypt } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { accounts } from "../db/schemas/index.js";
import { GitHubImportFailedError, GitHubNotConnectedError } from "../http/errors.js";
import type { Logger } from "../logger.js";

/** The only two hosts this service will ever talk to. */
const GITHUB_API = "https://api.github.com";
const GITHUB_RAW = "https://raw.githubusercontent.com";

/** GitHub asks that a caller identify itself, and refuses requests without one. */
const USER_AGENT = "skill-registry";

/** Matches the `provider_id` Better Auth writes for a GitHub login (ADR-0017). */
const GITHUB_PROVIDER_ID = "github";

/**
 * Whether a stored token is ciphertext rather than a token.
 *
 * @remarks
 * Better Auth's own read applies the same test, and it is the reason enabling
 * `encryptOAuthTokens` did not strand the rows written before it: a value that
 * does not look encrypted is returned untouched. `symmetricEncrypt` under a
 * string secret emits bare lowercase hex, and no GitHub token is hex — they
 * carry a `gho_`-style prefix — so the two cannot be confused.
 *
 * @param stored - The `access_token` column's value.
 * @returns Whether to decrypt it before use.
 */
function isEncrypted(stored: string): boolean {
  return stored.length % 2 === 0 && /^[0-9a-f]+$/i.test(stored);
}

/** The subset of GitHub's Contents API entry shape this service reads. */
interface ContentsEntry {
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size?: number;
  download_url: string | null;
}

/** One fetched file, on its way to the browser as base64. */
export interface ImportedFile {
  path: string;
  content_base64: string;
}

/**
 * Reads a Skill's files from a GitHub repository the caller can see,
 * including a private one, using that caller's own OAuth token (ADR-0020).
 */
export class GitHubImportService {
  constructor(
    private readonly db: Database,
    /** Better Auth's signing secret — also what OAuth tokens are encrypted under. */
    private readonly secret: string,
    private readonly logger: Logger,
  ) {}

  /**
   * Fetches every file under a folder in a repository the caller can reach.
   *
   * @remarks
   * The request is built from `location`'s parts, never from a URL a caller
   * supplied — every outbound request is `api.github.com` or
   * `raw.githubusercontent.com` with validated segments interpolated, so this
   * cannot be pointed at another host (ADR-0020).
   *
   * It runs as the caller and nobody else: the token comes from *their* linked
   * GitHub account, so this reaches exactly the repositories they can already
   * read, and a User with no linked account gets an error rather than somebody
   * else's access.
   *
   * @param userId - The User importing, whose GitHub token is used.
   * @param location - The repository, ref, and folder to read.
   * @returns The folder's files, base64-encoded, at paths relative to it.
   * @throws GitHubNotConnectedError if the User has no linked GitHub account.
   * @throws GitHubImportFailedError if GitHub refuses the request, the folder
   * is empty, or the folder is larger than an Artifact may be.
   * @example
   * ```ts
   * const files = await githubImport.fetchSkillFiles(user.id, {
   *   owner: "acme", repo: "skills", ref: null, path: "code-review",
   * });
   * ```
   */
  async fetchSkillFiles(userId: string, location: GitHubImportRequest): Promise<ImportedFile[]> {
    const token = await this.accessToken(userId);
    const ref = location.ref ?? (await this.defaultBranch(token, location));

    const files: ImportedFile[] = [];
    let totalBytes = 0;

    const walk = async (path: string): Promise<void> => {
      const entries = await this.contents(token, location, path, ref);

      for (const entry of entries) {
        if (entry.type === "dir") {
          await walk(entry.path);
          continue;
        }
        // Symlinks and submodules are dropped, exactly as the publishing
        // pipeline already drops excluded paths.
        if (entry.type !== "file") continue;

        // Counted before fetching, so an oversized repository is refused
        // rather than pulled into memory first.
        if (files.length >= ARTIFACT_MAX_ENTRIES) {
          throw new GitHubImportFailedError(
            `That folder holds more than ${ARTIFACT_MAX_ENTRIES} files, which is more than a Skill may contain.`,
          );
        }
        totalBytes += entry.size ?? 0;
        if (totalBytes > ARTIFACT_MAX_UNCOMPRESSED_BYTES) {
          throw new GitHubImportFailedError("That folder is larger than a Skill may be.");
        }

        const bytes = await this.download(token, entry);
        files.push({
          path: entry.path.slice(location.path.length).replace(/^\//, ""),
          content_base64: Buffer.from(bytes).toString("base64"),
        });
      }
    };

    await walk(location.path);

    if (files.length === 0) {
      throw new GitHubImportFailedError("That folder is empty, or doesn't exist at that ref.");
    }

    this.logger.info(
      { user_id: userId, owner: location.owner, repo: location.repo, files: files.length },
      "imported a skill folder from github",
    );
    return files;
  }

  /**
   * The caller's own GitHub token, in the form GitHub will accept.
   *
   * @remarks
   * Read per import rather than cached: revoking the link, or signing in again
   * with a refreshed token, has to take effect immediately.
   *
   * The column holds ciphertext rather than a token — `encryptOAuthTokens` is
   * on (ADR-0020), so what Better Auth wrote is AES-256-GCM under the signing
   * secret, and sending it verbatim would have GitHub refuse every import.
   */
  private async accessToken(userId: string): Promise<string> {
    const [account] = await this.db
      .select({ access_token: accounts.access_token })
      .from(accounts)
      .where(and(eq(accounts.user_id, userId), eq(accounts.provider_id, GITHUB_PROVIDER_ID)))
      .limit(1);

    if (!account?.access_token) throw new GitHubNotConnectedError();

    if (!isEncrypted(account.access_token)) return account.access_token;
    return symmetricDecrypt({ key: this.secret, data: account.access_token });
  }

  private async request(token: string, url: string): Promise<Response> {
    return fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": USER_AGENT,
      },
      // GitHub answers every one of these directly; following a redirect
      // elsewhere is the one way a fixed host could still reach another.
      redirect: "manual",
    });
  }

  private async defaultBranch(token: string, location: GitHubImportRequest): Promise<string> {
    const url = `${GITHUB_API}/repos/${location.owner}/${location.repo}`;
    const res = await this.request(token, url);
    if (!res.ok) throw this.failure(res.status);
    return ((await res.json()) as { default_branch: string }).default_branch;
  }

  private async contents(
    token: string,
    location: GitHubImportRequest,
    path: string,
    ref: string,
  ): Promise<ContentsEntry[]> {
    const url =
      `${GITHUB_API}/repos/${location.owner}/${location.repo}/contents/${path}` +
      `?ref=${encodeURIComponent(ref)}`;
    const res = await this.request(token, url);
    if (!res.ok) throw this.failure(res.status);

    const body = (await res.json()) as ContentsEntry | ContentsEntry[];
    return Array.isArray(body) ? body : [body];
  }

  private async download(token: string, entry: ContentsEntry): Promise<ArrayBuffer> {
    // `download_url` comes from GitHub rather than from the caller, but it is
    // still checked against the host it is supposed to be: it is the one URL
    // here this service did not build itself.
    if (!entry.download_url?.startsWith(`${GITHUB_RAW}/`)) {
      throw new GitHubImportFailedError(`Couldn't fetch "${entry.path}" from GitHub.`);
    }

    const res = await this.request(token, entry.download_url);
    if (!res.ok) throw new GitHubImportFailedError(`Couldn't fetch "${entry.path}" from GitHub.`);
    return res.arrayBuffer();
  }

  /** GitHub's status codes, as sentences a writer can act on. */
  private failure(status: number): GitHubImportFailedError {
    if (status === 404) {
      return new GitHubImportFailedError(
        "Couldn't find that repository or folder with your GitHub account. Check the URL, and that your " +
          "GitHub sign-in has access to it.",
      );
    }
    if (status === 401 || status === 403) {
      return new GitHubImportFailedError(
        "GitHub refused that request. Sign in with GitHub again to refresh the Registry's access.",
      );
    }
    return new GitHubImportFailedError(`GitHub request failed (${status}).`);
  }
}
