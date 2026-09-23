import { relative, resolve, sep } from "node:path";
import {
  buildSkillBundle,
  SKILL_DISCOVERY_MAX_DEPTH,
  SKILL_FILE_NAME,
  SkillPublishedSchema,
  SkillValidationError,
  type SkillBundle,
} from "@in-org-quicko/skillset-shared";
import { rethrowValidationError } from "../errors.js";
import { ApiError, registryFetch, uploadArtifactFiles, type RegistryClient } from "../http.js";
import { openAuthenticatedClient, type SessionDeps } from "../session.js";
import { describeError } from "../ui.js";
import {
  discoverSkillDirectories,
  holdsSkillFile,
  isRepositoryUrl,
  readRepositorySkill,
  walkSkillDirectory,
  type Progress,
} from "@in-org-quicko/skillset-installer";

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
  /** Reports the clone a URL publish starts with. Absent under `--json`. */
  progress?: Progress;
}

export interface PublishOptions {
  /**
   * A path — defaulting to `deps.cwd`, "the directory I am working in" (story
   * 15) — or a GitHub or GitLab URL to clone the Skill out of (ADR-0044).
   */
  target?: string;
  /**
   * `--name`: which Skill to publish out of a URL, by the name its `SKILL.md`
   * declares. Required with a URL, refused with a path.
   */
  skillName?: string;
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
async function buildBundles(root: string, directories: readonly string[]): Promise<SkillBundle[]> {
  const bundles: SkillBundle[] = [];
  for (const directory of directories) {
    try {
      bundles.push(buildSkillBundle(await walkSkillDirectory(directory)));
    } catch (error) {
      if (!(error instanceof SkillValidationError)) throw error;
      const label = relative(root, directory).split(sep).join("/") || ".";
      throw new Error(`${label}: ${error.rule}: ${error.message}${error.field ? ` (${error.field})` : ""}`);
    }
  }
  return bundles;
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
 * Publishes the Skill at a directory, or every Skill beneath it — or one named
 * Skill out of a GitHub or GitLab repository.
 *
 * @param deps - The fetch implementation, config-file path, environment, the directory a
 * relative path is resolved against, whether a terminal is attached, how to confirm
 * publishing more than one Skill, and how to report the clone a URL starts with.
 * @param options - `target`, a path (default `deps.cwd`) or a repository URL; `skillName`
 * (`--name`), which Skill to publish out of a URL; and `yes`, which skips the confirmation
 * before publishing more than one Skill, for automation with no terminal attached.
 * @returns The published Skill's name, id, and publish timestamp for a URL, or for a path
 * that itself holds a `SKILL.md`. For any other path, every Skill found beneath it up to
 * `SKILL_DISCOVERY_MAX_DEPTH` levels deep is published, and the outcome of each is returned
 * individually rather than thrown: a failure part-way through does not stop the rest.
 * @throws Error when a URL is given without `--name`, or `--name` with a path.
 * @throws Error naming the rule and the offending directory when a Skill fails the local
 * check — thrown before the Registry is contacted — or when no Skill is found at all.
 * @throws Error with git's own message when a URL cannot be cloned, or naming every Skill
 * found when none there declares `--name`.
 * @throws Error explaining how to authenticate when no Registry and Token are configured.
 * @throws Error when publishing more than one Skill needs confirmation and none can be
 * given — no terminal is attached and `--yes` was not passed — or when the User declines.
 * @throws Error about permissions when the Registry answers 403 for a single-Skill publish,
 * so a reader's Token is refused with a reason rather than a generic failure; and about the
 * Token itself on 401. A multi-Skill publish reports the same wording per Skill instead.
 * @throws ApiError for any other refusal, and `RegistryUnreachableError` when neither the
 * Registry nor storage can be reached — again, only for a single-Skill publish.
 *
 * @remarks
 * Every Skill is validated locally with the same shared rules the API applies before the
 * Registry is contacted for any of them (ADR-0001's upload comes after).
 *
 * A URL is cloned with the User's own git, the same way `install` clones one, so any
 * repository they can clone publishes — private ones included — and the repository is
 * recorded as the Skill's Source and, through it, its Namespace (ADR-0041, ADR-0042,
 * ADR-0044). A path records no Source: the Skill reads as published straight here.
 *
 * @example
 * ```ts
 * const { name, id } = await runPublish(deps, { target: "./skills/code-review" }) as PublishResult;
 * const outcomes = await runPublish(deps, { target: "./skills", yes: true }) as PublishOutcome[];
 * await runPublish(deps, { target: "https://github.com/acme/skills", skillName: "pdf" });
 * ```
 */
export async function runPublish(deps: PublishDeps, options: PublishOptions): Promise<PublishResult | PublishOutcome[]> {
  const url = options.target !== undefined && isRepositoryUrl(options.target) ? options.target : null;
  if (url && !options.skillName) {
    throw new Error("Pass --name with a URL to say which Skill to publish — the name in its SKILL.md.");
  }
  if (!url && options.skillName) {
    throw new Error("--name picks a Skill out of a repository URL; a path already says which Skill to publish.");
  }

  if (url && options.skillName) {
    // Authenticated before cloning: a writer who is not logged in should hear
    // that before waiting on a clone that was never going to be published.
    const client = await openAuthenticatedClient(deps);
    const { bundle } = await readRepositorySkill(url, options.skillName, deps.env, deps.progress);
    return publishBundle(client, deps.fetch, bundle);
  }

  const targetPath = options.target ? resolve(deps.cwd, options.target) : deps.cwd;

  if (await holdsSkillFile(targetPath)) {
    let bundle;
    try {
      bundle = buildSkillBundle(await walkSkillDirectory(targetPath));
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

  return publishAll(deps, await buildBundles(targetPath, directories), options);
}
