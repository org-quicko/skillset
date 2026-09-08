import {
  discoverSkillFolders,
  gitProviderConfig,
  readSkillFolder,
  SkillFolderError,
  type SkillFile,
  type SkillSourceLocation,
} from "@skillset/shared";
import {
  AppNotInstalledError,
  ConnectionExpiredError,
  ImportFailedError,
  ImportRejectedError,
  IntegrationNotConfiguredError,
} from "../http/errors.js";
import type { Logger } from "../logger.js";
import type { ConnectionsService } from "./connections.js";
import type { IntegrationsService } from "./integrations.js";

/**
 * The reasons that are the provider's fault, as sentences a connected writer
 * can act on.
 *
 * @remarks
 * Deliberately not the shared module's own wording. These address someone
 * importing under their own Connection, so a refusal points at that grant; the
 * browser's anonymous path says something different for the same reasons,
 * because it has no credential to talk about.
 *
 * `unauthorized` and `not_found` are absent: both are handled before this map
 * is reached, because both have a better answer than a sentence. The first
 * becomes `connection_expired`, and the second is diagnosed against what the
 * app is actually installed on.
 */
const UPSTREAM_MESSAGES: Record<"rate_limited" | "request_failed" | "untrusted_download_host", string> = {
  rate_limited:
    "That provider rate-limited this request. Wait a bit and try again, or upload the Skill's folder instead.",
  request_failed: "That provider could not be reached. Try again, or upload the Skill's folder instead.",
  untrusted_download_host: "A file came back from an unexpected host, so it was not fetched.",
};

/**
 * The reasons that are the caller's folder, not the provider.
 *
 * @remarks
 * Kept apart from `UPSTREAM_MESSAGES` because the two want different statuses.
 * Nothing failed for these — the provider answered perfectly well, and the
 * answer is that this folder is not publishable as a Skill. Reporting them as
 * 502 would invite a retry that can never succeed and would put a writer
 * pasting an oversized directory into the 5xx rate.
 */
const REJECTION_MESSAGES: Record<"empty_folder" | "too_many_entries" | "uncompressed_too_large", string> = {
  empty_folder: "That folder is empty, or doesn't exist at that ref.",
  too_many_entries: "That folder holds more files than a Skill may contain.",
  uncompressed_too_large: "That folder is larger than a Skill may be.",
};

/** What `GET /user/installations` reports, in the part this reads. */
interface Installations {
  installations?: { account?: { login?: string } }[];
}

/**
 * Reading a Skill's files out of a project the caller's Connection can see,
 * private ones included (ADR-0024).
 *
 * @remarks
 * What is left here is the credential and the diagnosis, not the reading. The
 * walk itself is `readSkillFolder` in shared, which the browser's anonymous
 * path runs too — the only difference between them is the token.
 *
 * It reads nothing from `identity_providers`. That is the whole point of
 * ADR-0024: signing in with GitHub and Importing from GitHub are two
 * registrations, so an Admin can turn either off and leave the other working.
 */
export class ImportsService {
  constructor(
    private readonly logger: Logger,
    private readonly integrations: IntegrationsService,
    private readonly connections: ConnectionsService,
  ) {}

  /**
   * Fetches every file under a folder in a project the caller can reach.
   *
   * @remarks
   * It runs as the caller and nobody else: the token comes from *their* own
   * Connection, so this reaches exactly the projects that grant covers — which
   * is the repositories an owner selected when the app was installed, not
   * everything the writer can read (ADR-0024).
   *
   * The preconditions are checked in this order on purpose. An Integration's
   * absence is an Admin's problem and is refused before a Connection is so
   * much as selected, because "nobody has configured this" and "you have not
   * connected" have different remedies and the first is not the writer's to
   * take.
   *
   * Every request is built from `location`'s validated parts and the
   * provider's pinned API base, never from a URL a caller supplied, so this
   * cannot be pointed at another host (ADR-0020). Every request the walk makes
   * is a `GET`; nothing here writes to a provider.
   *
   * @param userId - The writer importing, whose Connection is spent.
   * @param location - The provider, project, ref, and folder to read.
   * @param fetchImpl - The `fetch` to reach the provider with. Defaults to the
   * global one; tests pass a fake so a request never leaves the process.
   * @returns The folder's files, at paths relative to it.
   * @throws IntegrationNotConfiguredError if no Integration is configured for
   * that Git Provider, whether or not the caller holds a Connection.
   * @throws NotConnectedError if the caller holds no Connection to it.
   * @throws ConnectionExpiredError if the grant can no longer be refreshed, or
   * the provider refuses it outright.
   * @throws AppNotInstalledError if a 404 turns out to be the app not being
   * installed on the project's owner, rather than a missing folder.
   * @throws ImportFailedError if the provider refuses for any other reason,
   * rate-limits the request, or cannot be reached.
   * @throws ImportRejectedError if the folder is empty or larger than an
   * Artifact may be — the caller's folder rather than the provider, hence a
   * 4xx.
   * @example
   * ```ts
   * const files = await imports.fetchSkillFiles(user.id, {
   *   provider: "github", project: "acme/skills", ref: null, path: "code-review",
   * });
   * ```
   */
  async fetchSkillFiles(
    userId: string,
    location: SkillSourceLocation,
    fetchImpl?: typeof fetch,
  ): Promise<SkillFile[]> {
    const configured = await this.integrations.listByProvider(location.provider);
    if (configured.length === 0) {
      this.logger.info(
        { user_id: userId, provider: location.provider },
        "refused an import because no integration is configured for that git provider",
      );
      throw new IntegrationNotConfiguredError(location.provider);
    }

    const token = await this.connections.accessTokenFor(userId, location.provider, fetchImpl);

    let files: SkillFile[];
    try {
      files = await readSkillFolder(location, { token, fetch: fetchImpl });
    } catch (cause) {
      if (cause instanceof SkillFolderError) {
        // The writer's *own* app, not an arbitrary Integration configured for
        // the provider (ADR-0025) — a sibling app for the same provider may
        // carry a different slug, and the install link must point at the one
        // this Connection actually runs through.
        const integration = await this.connections.integrationFor(userId, location.provider);
        throw await this.refusal(cause, userId, location, integration?.app_slug ?? null, token, fetchImpl);
      }
      throw cause;
    }

    this.logger.info(
      { user_id: userId, provider: location.provider, project: location.project, files: files.length },
      "imported a skill folder",
    );
    return files;
  }

  /**
   * Finds every Skill folder in a project the caller's Connection can see,
   * private ones included (ADR-0024) — the discovery companion to
   * {@link fetchSkillFiles} for a location that may hold more than one Skill.
   *
   * @remarks
   * Shares every precondition and diagnosis {@link fetchSkillFiles} has: an
   * Integration must be configured, the caller must hold a Connection, and a
   * 404 is diagnosed against `GET /user/installations` before it is reported
   * as a missing project rather than an uninstalled app. Two reasons read
   * differently because they describe a walk's outcome, not one named
   * folder's: finding nothing at all means no Skill was found, not that the
   * folder itself is empty, and running out of room means the project has
   * more to search than a walk will look through, not that one folder holds
   * too many files.
   *
   * @param userId - The writer discovering, whose Connection is spent.
   * @param location - The provider, project, ref, and folder to search from.
   * @param fetchImpl - The `fetch` to reach the provider with. Defaults to
   * the global one; tests pass a fake so a request never leaves the process.
   * @returns Every Skill folder found, as a `SkillSourceLocation` each.
   * @throws IntegrationNotConfiguredError if no Integration is configured for
   * that Git Provider.
   * @throws NotConnectedError if the caller holds no Connection to it.
   * @throws ConnectionExpiredError if the grant can no longer be refreshed, or
   * the provider refuses it outright.
   * @throws AppNotInstalledError if a 404 turns out to be the app not being
   * installed on the project's owner, rather than a missing folder.
   * @throws ImportFailedError if the provider refuses for any other reason,
   * rate-limits the request, or cannot be reached.
   * @throws ImportRejectedError if no Skill was found, or the project holds
   * more entries than a discovery walk will search.
   * @example
   * ```ts
   * const found = await imports.listSkillFolders(user.id, {
   *   provider: "github", project: "acme/skills", ref: null, path: "",
   * });
   * ```
   */
  async listSkillFolders(
    userId: string,
    location: SkillSourceLocation,
    fetchImpl?: typeof fetch,
  ): Promise<SkillSourceLocation[]> {
    const configured = await this.integrations.listByProvider(location.provider);
    if (configured.length === 0) {
      this.logger.info(
        { user_id: userId, provider: location.provider },
        "refused a discovery walk because no integration is configured for that git provider",
      );
      throw new IntegrationNotConfiguredError(location.provider);
    }

    const token = await this.connections.accessTokenFor(userId, location.provider, fetchImpl);

    let found: SkillSourceLocation[];
    try {
      found = await discoverSkillFolders(location, { token, fetch: fetchImpl });
    } catch (cause) {
      if (!(cause instanceof SkillFolderError)) throw cause;

      // Unlike fetchSkillFiles's own folder, these two reasons describe a *walk*
      // outcome, not a single named folder's — REJECTION_MESSAGES's wording for
      // both ("that folder is empty" / "that folder holds more files than a
      // Skill may contain") is written for the latter and would mislead here.
      if (cause.reason === "empty_folder") {
        throw new ImportRejectedError("No Skill was found under that project or folder.");
      }
      if (cause.reason === "too_many_entries") {
        throw new ImportRejectedError("That project has more to search than a discovery walk will look through.");
      }

      const integration = await this.connections.integrationFor(userId, location.provider);
      throw await this.refusal(cause, userId, location, integration?.app_slug ?? null, token, fetchImpl);
    }

    this.logger.info(
      { user_id: userId, provider: location.provider, project: location.project, found: found.length },
      "discovered skill folders",
    );
    return found;
  }

  /**
   * Turns the walk's reason into the refusal a connected writer should see.
   *
   * @remarks
   * Two reasons get more than a sentence. `unauthorized` usually means the
   * grant itself is spent, so it becomes `connection_expired` and says
   * *reconnect* — never "sign in again", which refreshes nothing now that the
   * Import token does not come from the login. It can also mean the Registry's
   * app lacks a permission, which reconnecting cannot fix, so the message
   * admits that second possibility rather than sending a writer round the same
   * loop indefinitely. The walk collapses 401 and 403 into one reason and
   * discards the provider's explanatory body, so the two cannot be told apart
   * here without more plumbing than the distinction is worth.
   *
   * `not_found` is the one worth spending a request on. A project the app is
   * not installed on answers 404 exactly as a mistyped one does, and the
   * remedies could not be more different — so it asks what the Connection can
   * actually see before deciding which to say.
   *
   * @param cause - The walk's own error.
   * @param userId - The importer, for the log line.
   * @param location - What was being read.
   * @param appSlug - The Integration's app slug, for the install link.
   * @param token - The caller's access token, to ask what is installed.
   * @param fetchImpl - The `fetch` to ask with.
   * @returns The error to throw.
   */
  private async refusal(
    cause: SkillFolderError,
    userId: string,
    location: SkillSourceLocation,
    appSlug: string | null,
    token: string,
    fetchImpl?: typeof fetch,
  ): Promise<Error> {
    if (cause.reason === "unauthorized") {
      this.logger.info(
        { user_id: userId, provider: location.provider },
        "import refused by the provider — the connection's grant is no longer accepted",
      );
      return new ConnectionExpiredError(location.provider);
    }

    if (cause.reason === "not_found") {
      const owner = location.project.split("/")[0] ?? location.project;
      if (await this.appIsInstalledOn(location.provider, owner, token, fetchImpl)) {
        // Installed, so the 404 is what it looks like: the folder or the ref is
        // not there. Telling them to install it again would send them in a
        // circle — and this is a mistyped URL, the commonest failure there is,
        // so it is the caller's 4xx rather than the provider's 5xx.
        return new ImportRejectedError(
          "Couldn't find that project or folder. Check the URL, and that the folder exists at that ref.",
        );
      }

      this.logger.info(
        { user_id: userId, provider: location.provider, owner },
        "import refused because the app is not installed on the project's owner",
      );
      return new AppNotInstalledError(
        owner,
        appSlug ? this.installUrl(location.provider, appSlug) : null,
      );
    }

    if (cause.reason in REJECTION_MESSAGES) {
      return new ImportRejectedError(REJECTION_MESSAGES[cause.reason as keyof typeof REJECTION_MESSAGES]);
    }
    return new ImportFailedError(UPSTREAM_MESSAGES[cause.reason as keyof typeof UPSTREAM_MESSAGES]);
  }

  /**
   * Whether the Registry's app is installed on an account the caller can see.
   *
   * @remarks
   * A diagnosis, so it must not become a failure of its own. If the question
   * cannot be answered — the provider refuses it, or the response is not what
   * was expected — this answers `true`, which means the caller gets the plain
   * not-found rather than being told to install something that may well
   * already be installed. Guessing wrong in that direction wastes a moment;
   * guessing wrong in the other sends an Admin hunting for a problem that is
   * not there.
   *
   * @param provider - The Git Provider to ask.
   * @param owner - The account that owns the project.
   * @param token - The caller's access token.
   * @param fetchImpl - The `fetch` to ask with.
   * @returns Whether an installation on `owner` is visible to this caller.
   */
  private async appIsInstalledOn(
    provider: string,
    owner: string,
    token: string,
    fetchImpl?: typeof fetch,
  ): Promise<boolean> {
    try {
      const res = await (fetchImpl ?? globalThis.fetch)(`${gitProviderConfig(provider).api_base}/user/installations`, {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "user-agent": "skillset",
        },
        redirect: "manual",
      });
      if (!res.ok) return true;

      const body = (await res.json()) as Installations;
      if (!Array.isArray(body.installations)) return true;

      // Case-insensitive: provider account names are, and an owner typed in a
      // different case is the same owner.
      const target = owner.toLowerCase();
      return body.installations.some((installation) => installation.account?.login?.toLowerCase() === target);
    } catch {
      return true;
    }
  }

  /** The provider's installation page for this Registry's app. */
  private installUrl(provider: string, appSlug: string): string | null {
    const template = gitProviderConfig(provider).oauth?.install_url_template;
    return template ? template.replace("{app_slug}", appSlug) : null;
  }
}
