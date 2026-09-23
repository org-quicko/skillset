import { relative, resolve, sep } from "node:path";
import {
  buildSkillBundle,
  discoverSkillFolders,
  parseSkillSourceUrl,
  readSkillFolder,
  resourceSourceUrl,
  SKILL_DISCOVERY_MAX_DEPTH,
  SKILL_FILE_NAME,
  SkillFolderError,
  SkillPublishedSchema,
  SkillValidationError,
  type SkillBundle,
} from "@in-org-quicko/skillset-shared";
import { rethrowValidationError } from "../errors.js";
import { discoverSkillDirectories, holdsSkillFile, walkSkillDirectory } from "../skill-directory.js";
import { ApiError, registryFetch, uploadArtifactFiles, type RegistryClient } from "../http.js";
import { openAuthenticatedClient, type SessionDeps } from "../session.js";
import { describeError } from "../ui.js";

export interface PublishDeps extends SessionDeps {
  cwd: string;
  /** Whether a terminal is attached — decides whether publishing more than one Skill can be confirmed interactively. */
  isTTY: boolean;
  /**
   * Asks whether to proceed, given the names of the Skills about to be published (and, for any
   * that already exist, replaced). Called only when more than one Skill was discovered and
   * `options.yes` was not passed.
   */
  confirm(names: readonly string[]): Promise<boolean>;
}

export interface PublishOptions {
  /** Defaults to `deps.cwd` — "the directory I am working in" (story 15). */
  path?: string;
  /**
   * `--from`: a GitHub or GitLab URL to read the Skill out of instead of the
   * disk. Public projects only — see {@link bundlesFromUrl}.
   */
  from?: string;
  /**
   * `--source`: the repository these bytes came from, recorded as the
   * Resource's Source (ADR-0041) and, through it, its Namespace (ADR-0042).
   * For publishing a checkout of a private repository, which `--from` cannot
   * reach. Ignored when `--from` is given, which knows its own.
   */
  source?: string;
  /** Skips the multi-Skill confirmation prompt, for automation with no terminal attached. */
  yes?: boolean;
}

export interface PublishResult {
  name: string;
  id: string;
  published_at: string;
}

/** One Skill's outcome from a multi-Skill publish — reported individually rather than aborting the batch. */
export type PublishOutcome =
  | ({ name: string; status: "published" } & PublishResult)
  | { name: string; status: "failed"; error: string };

/**
 * PUTs a Skill's metadata, then uploads its Artifact straight to storage (ADR-0001).
 *
 * @throws Error about permissions when the Registry answers 403, so a reader's Token is
 * refused with a reason rather than a generic failure; and about the Token itself on 401.
 * @throws ApiError for any other refusal, and `RegistryUnreachableError` when neither the
 * Registry nor storage can be reached.
 */
async function publishBundle(client: RegistryClient, fetchImpl: typeof fetch, bundle: SkillBundle): Promise<PublishResult> {
  let published;
  try {
    published = await registryFetch(client, `/resources/skill/${encodeURIComponent(bundle.name)}`, SkillPublishedSchema, {
      method: "PUT",
      body: JSON.stringify(bundle.request),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      throw new Error("This Token is not allowed to publish — publishing needs the writer role or higher.");
    }
    if (error instanceof ApiError && error.status === 401) {
      throw new Error("Token rejected — mint a new one from the web interface.");
    }
    throw error;
  }

  await uploadArtifactFiles(fetchImpl, published.upload.files, bundle.files);

  return { name: published.skill.name, id: published.skill.id, published_at: published.skill.published_at };
}

/**
 * Builds every discovered Skill's bundle before publishing any of them, so one bad Skill
 * aborts the whole batch rather than leaving it half-published.
 *
 * @throws Error naming the rule and the offending directory when a Skill fails the local
 * check — thrown before the Registry is contacted at all.
 */
async function buildBundles(root: string, directories: readonly string[], source?: string): Promise<SkillBundle[]> {
  const bundles: SkillBundle[] = [];
  for (const directory of directories) {
    try {
      bundles.push(buildSkillBundle(await walkSkillDirectory(directory), { source }));
    } catch (error) {
      if (!(error instanceof SkillValidationError)) throw error;
      const label = relative(root, directory).split(sep).join("/") || ".";
      throw new Error(`${label}: ${error.rule}: ${error.message}${error.field ? ` (${error.field})` : ""}`);
    }
  }
  return bundles;
}

/**
 * Reads every Skill a Git Provider URL points at, ready to publish.
 *
 * @param url - A GitHub or GitLab URL: a repository, a tree at a ref, or a
 * folder within one.
 * @param fetchImpl - The `fetch` to reach the provider with, injected the same way
 * every other request in this CLI is.
 * @returns Each Skill found, and whether the URL named exactly one — true when
 * the folder it points at is itself a Skill, mirroring what publishing a path
 * that holds a `SKILL.md` means.
 * @throws Error naming what went wrong when the project or folder cannot be
 * read: it does not exist, it is private, or the provider rate-limited the
 * walk.
 * @throws Error when the URL is not one of a Git Provider this Registry reads.
 *
 * @remarks
 * Anonymous, so **public projects only** (ADR-0010). This deliberately does not
 * go through the Registry's `/imports` routes: those exist because a browser
 * cannot read a repository, and they need a Connection granted through one —
 * neither of which applies to a CLI running on a machine that can already read
 * the repository itself. A private one is published by checking it out and
 * passing `--source`, which costs no credential handling here at all.
 *
 * Each Skill records the **repository** it came from as its Source, without the
 * ref or the folder (ADR-0041), so a monorepo's Skills share one — and through
 * it, one Namespace (ADR-0042).
 */
async function bundlesFromUrl(url: string, fetchImpl: typeof fetch): Promise<{ bundles: SkillBundle[]; single: boolean }> {
  const location = parseSkillSourceUrl(url);

  let found;
  try {
    found = await discoverSkillFolders(location, { fetch: fetchImpl });
  } catch (error) {
    if (!(error instanceof SkillFolderError)) throw error;
    throw new Error(`${url}: ${error.message}`);
  }

  if (found.length === 0) {
    throw new Error(`No Skill found at ${url} — looked for a directory holding ${SKILL_FILE_NAME}.`);
  }

  const bundles: SkillBundle[] = [];
  for (const folder of found) {
    let files;
    try {
      files = await readSkillFolder(folder, { fetch: fetchImpl });
    } catch (error) {
      if (!(error instanceof SkillFolderError)) throw error;
      throw new Error(`${folder.path || "/"}: ${error.message}`);
    }
    try {
      bundles.push(buildSkillBundle(files, { source: resourceSourceUrl(folder) }));
    } catch (error) {
      if (!(error instanceof SkillValidationError)) throw error;
      throw new Error(`${folder.path || "/"}: ${error.rule}: ${error.message}${error.field ? ` (${error.field})` : ""}`);
    }
  }

  return { bundles, single: found.length === 1 && found[0]?.path === location.path };
}

/**
 * Authenticates, confirms a batch when there is one to confirm, and publishes
 * every bundle — reporting each outcome rather than aborting on the first
 * failure.
 *
 * @throws Error when publishing more than one Skill needs confirmation and none
 * can be given, or when the User declines.
 */
async function publishAll(deps: PublishDeps, bundles: readonly SkillBundle[], options: PublishOptions): Promise<PublishOutcome[]> {
  // Authenticate before confirming, not after: a writer who isn't logged in
  // should be told that up front, rather than answering a confirmation
  // prompt for a batch that was never going to reach the Registry anyway.
  const client = await openAuthenticatedClient(deps);

  if (bundles.length > 1 && !options.yes) {
    const names = bundles.map((bundle) => bundle.name);
    if (!deps.isTTY) {
      throw new Error(`Publishing ${names.length} Skills needs confirmation — pass --yes to skip it.`);
    }
    if (!(await deps.confirm(names))) throw new Error("Cancelled.");
  }

  const outcomes: PublishOutcome[] = [];
  for (const bundle of bundles) {
    try {
      outcomes.push({ ...(await publishBundle(client, deps.fetch, bundle)), status: "published" });
    } catch (error) {
      outcomes.push({ name: bundle.name, status: "failed", error: describeError(error).title });
    }
  }
  return outcomes;
}

/**
 * Publishes the Skill at a directory, or every Skill beneath it.
 *
 * @param deps - The fetch implementation, config-file path, environment, the directory a
 * relative `options.path` is resolved against, whether a terminal is attached, and how to
 * confirm publishing more than one Skill.
 * @param options - Where to look; defaults to `deps.cwd`. `from` reads from a Git Provider
 * URL instead of the disk, and records the repository as each Skill's Source. `source`
 * declares that repository by hand, for a checkout of one `from` cannot reach. `yes` skips
 * the confirmation before publishing more than one Skill, for automation with no terminal
 * attached.
 * @returns The published Skill's name, id, and publish timestamp, when `options.path` (or
 * `deps.cwd`) itself holds a `SKILL.md` — publishing that one Skill exactly as before. When
 * it does not, every Skill found beneath it up to `SKILL_DISCOVERY_MAX_DEPTH` levels deep is
 * published instead, and the outcome of each is returned individually rather than thrown: a
 * publish failure part-way through does not stop the rest from being attempted or reported.
 * @throws Error naming the rule and the offending directory when a Skill fails the local
 * check — thrown before the Registry is contacted at all — or when no Skill is found at all.
 * @throws Error explaining how to authenticate when no Registry and Token are configured.
 * @throws Error when publishing more than one Skill needs confirmation and none can be
 * given — no terminal is attached and `--yes` was not passed — or when the User declines.
 * @throws Error about permissions when the Registry answers 403 for the single-Skill case,
 * so a reader's Token is refused with a reason rather than a generic failure; and about the
 * Token itself on 401. A multi-Skill publish reports the same wording per Skill instead of
 * throwing it.
 * @throws ApiError for any other refusal, and `RegistryUnreachableError` when neither the
 * Registry nor storage can be reached — again, only for the single-Skill case.
 *
 * @remarks
 * Every Skill is validated locally with the same shared rules the API applies before the
 * Registry is contacted for any of them (ADR-0001's upload comes after).
 *
 * @example
 * ```ts
 * const { name, id } = await runPublish(deps, { path: "./skills/code-review" }) as PublishResult;
 * ```
 * @example
 * ```ts
 * const outcomes = await runPublish(deps, { path: "./skills", yes: true }) as PublishOutcome[];
 * ```
 */
export async function runPublish(deps: PublishDeps, options: PublishOptions): Promise<PublishResult | PublishOutcome[]> {
  // A URL replaces the disk entirely, so no path is resolved and nothing under
  // `deps.cwd` is read. The two shapes of answer are the same as the local
  // ones, and for the same reason: naming one Skill returns that Skill, and
  // naming somewhere Skills live reports each of them.
  if (options.from) {
    const { bundles, single } = await bundlesFromUrl(options.from, deps.fetch);
    if (single) {
      const [only] = bundles;
      if (!only) throw new Error(`No Skill found at ${options.from}.`);
      return publishBundle(await openAuthenticatedClient(deps), deps.fetch, only);
    }
    return publishAll(deps, bundles, options);
  }

  const targetPath = options.path ? resolve(deps.cwd, options.path) : deps.cwd;

  if (await holdsSkillFile(targetPath)) {
    let bundle;
    try {
      bundle = buildSkillBundle(await walkSkillDirectory(targetPath), { source: options.source });
    } catch (error) {
      rethrowValidationError(error);
    }
    return publishBundle(await openAuthenticatedClient(deps), deps.fetch, bundle);
  }

  const directories = await discoverSkillDirectories(targetPath);
  if (directories.length === 0) {
    throw new Error(
      `No Skill found under "${targetPath}" — looked up to ${SKILL_DISCOVERY_MAX_DEPTH} levels deep for a directory holding ${SKILL_FILE_NAME}.`,
    );
  }

  return publishAll(deps, await buildBundles(targetPath, directories, options.source), options);
}
