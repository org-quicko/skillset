import {
  GitHubFolderError,
  readGitHubFolder,
  type GitHubFolderReason,
  type GitHubImportRequest,
  type SkillFile,
} from "@skill-registry/shared";
import { symmetricDecrypt } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { accounts, identityProviders } from "../db/schemas/index.js";
import { GitHubImportFailedError, GitHubLoginDisabledError, GitHubNotConnectedError } from "../http/errors.js";
import type { Logger } from "../logger.js";

/**
 * Names GitHub in both tables this service reads: the `provider_id` Better
 * Auth writes for a GitHub login, and the `identity_providers.kind` whose
 * `enabled` flag governs whether that login's token may be used. They agree by
 * design, which is what makes a configured Provider and a linked account the
 * same GitHub (ADR-0017).
 */
const GITHUB_PROVIDER_ID = "github";

/**
 * The walk's reasons, as sentences an authenticated writer can act on.
 *
 * @remarks
 * Deliberately not the shared module's own wording. These address someone
 * signed in with GitHub, importing under their own access, so a refusal points
 * at their account; the browser's anonymous fallback says something different
 * for the same reason, because it has no credential to talk about.
 */
const IMPORT_FAILURE_MESSAGES: Record<GitHubFolderReason, string> = {
  not_found:
    "Couldn't find that repository or folder with your GitHub account. Check the URL, and that your " +
    "GitHub sign-in has access to it.",
  unauthorized: "GitHub refused that request. Sign in with GitHub again to refresh the Registry's access.",
  // Reachable with a token too — 5,000 requests an hour, not unlimited — and
  // "sign in again" is advice that fixes nothing here.
  rate_limited: "GitHub rate-limited this request. Wait a bit and try again, or upload the Skill's folder instead.",
  request_failed: "GitHub could not be reached. Try again, or upload the Skill's folder instead.",
  untrusted_download_host: "GitHub returned a file from an unexpected host, so it was not fetched.",
  empty_folder: "That folder is empty, or doesn't exist at that ref.",
  too_many_entries: "That folder holds more files than a Skill may contain.",
  uncompressed_too_large: "That folder is larger than a Skill may be.",
};

/**
 * Reads a Skill's files from a GitHub repository the caller can see,
 * including a private one, using that caller's own OAuth token (ADR-0020).
 *
 * @remarks
 * What is left here is the credential, not the reading: which Provider must be
 * enabled, whose token is spent, and in what order those two are checked. The
 * walk itself is `readGitHubFolder` in shared, which the browser's anonymous
 * fallback runs too.
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
   * It runs as the caller and nobody else: the token comes from *their* linked
   * GitHub account, so this reaches exactly the repositories they can already
   * read, and a User with no linked account gets an error rather than somebody
   * else's access.
   *
   * It also runs only while the GitHub Provider is enabled, and the order of
   * those two steps is the point. Disabling that Provider withdraws the
   * Registry's use of every stored GitHub token, not merely the login button —
   * the tokens are a by-product of the login (ADR-0020), so an operator who
   * turns the login off has withdrawn the consent they were collected under.
   * The check therefore runs before the column is so much as selected, and is
   * read per import, like the login's own `enabled` check (ADR-0019), so it
   * takes effect immediately.
   *
   * @param userId - The User importing, whose GitHub token is used.
   * @param location - The repository, ref, and folder to read.
   * @param fetchImpl - The `fetch` to read GitHub with. Defaults to the global
   * one; tests pass a fake so a request never leaves the process.
   * @returns The folder's files, at paths relative to it.
   * @throws GitHubLoginDisabledError if the GitHub Identity Provider is
   * disabled or was never configured, whether or not the User has a token.
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
  async fetchSkillFiles(
    userId: string,
    location: GitHubImportRequest,
    fetchImpl?: typeof fetch,
  ): Promise<SkillFile[]> {
    await this.assertGitHubLoginEnabled(userId);
    const token = await this.accessToken(userId);

    let files: SkillFile[];
    try {
      files = await readGitHubFolder(location, { token, fetch: fetchImpl });
    } catch (cause) {
      if (cause instanceof GitHubFolderError) {
        throw new GitHubImportFailedError(IMPORT_FAILURE_MESSAGES[cause.reason]);
      }
      throw cause;
    }

    this.logger.info(
      { user_id: userId, owner: location.owner, repo: location.repo, files: files.length },
      "imported a skill folder from github",
    );
    return files;
  }

  /**
   * Refuses the import unless GitHub is a configured, enabled Identity
   * Provider on this Registry.
   *
   * @remarks
   * A missing row is treated exactly as a disabled one. GitHub tokens outlive
   * the Provider that collected them — there is no delete route for a Provider
   * (ADR-0015), but an instance restored from a backup, or one whose Provider
   * was configured after some accounts were linked, can hold both — and "no
   * GitHub login here" is the same answer as "not right now".
   *
   * @param userId - The caller, recorded on the refusal so an operator can see
   * who is hitting a switch they flipped.
   * @throws GitHubLoginDisabledError if no enabled GitHub Provider is configured.
   */
  private async assertGitHubLoginEnabled(userId: string): Promise<void> {
    const [provider] = await this.db
      .select({ enabled: identityProviders.enabled })
      .from(identityProviders)
      .where(eq(identityProviders.kind, GITHUB_PROVIDER_ID))
      .limit(1);

    if (provider?.enabled) return;

    this.logger.info(
      { user_id: userId, configured: provider !== undefined },
      "refused a github import because github sign-in is not enabled",
    );
    throw new GitHubLoginDisabledError();
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
   * secret, and sending it verbatim would have GitHub refuse every import. A
   * value that does not look encrypted is returned untouched, which is what
   * kept the rows written before that flag was turned on working; Better
   * Auth's own read applies the same test.
   *
   * @param userId - The User whose linked GitHub account is read.
   * @returns The decrypted access token.
   * @throws GitHubNotConnectedError if the User has no linked GitHub account.
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
}

/**
 * Whether a stored token is ciphertext rather than a token.
 *
 * @remarks
 * `symmetricEncrypt` under a string secret emits bare lowercase hex, and no
 * GitHub token is hex — they carry a `gho_`-style prefix — so the two cannot
 * be confused.
 *
 * @param stored - The `access_token` column's value.
 * @returns Whether to decrypt it before use.
 */
function isEncrypted(stored: string): boolean {
  return stored.length % 2 === 0 && /^[0-9a-f]+$/i.test(stored);
}
