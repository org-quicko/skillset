import { access, readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  buildSkillBundle,
  isExcludedPath,
  SKILL_DISCOVERY_MAX_DEPTH,
  SKILL_FILE_NAME,
  SkillPublishedSchema,
  SkillValidationError,
  type SkillBundle,
  type SkillFile,
} from "@skill-registry/shared";
import { rethrowValidationError } from "../errors.js";
import { ApiError, registryFetch, uploadArtifactFile, type RegistryClient } from "../http.js";
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
 * Reads every file under `root`, skipping whatever `isExcludedPath` (shared)
 * would exclude anyway — pruning descent into `node_modules`/`.git`/etc.
 * rather than reading them and discarding the bytes.
 */
async function walkSkillDirectory(root: string, dir: string = root): Promise<SkillFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: SkillFile[] = [];

  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);
    const relativePath = relative(root, absolutePath).split(sep).join("/");
    if (isExcludedPath(relativePath)) continue;

    if (entry.isDirectory()) {
      files.push(...(await walkSkillDirectory(root, absolutePath)));
    } else if (entry.isFile()) {
      files.push({ path: relativePath, bytes: await readFile(absolutePath) });
    }
  }

  return files;
}

/**
 * Whether `dir` itself holds a `SKILL.md` — the mark of a Skill's own root.
 *
 * @remarks
 * Only a missing file reads as `false`. Anything else `access` throws — a
 * permission error, a broken symlink — is a real problem with `dir` and is
 * rethrown rather than silently rerouting into the discovery walk, which
 * would misreport it as "no Skill found" instead of naming the actual fault.
 */
async function holdsSkillFile(dir: string): Promise<boolean> {
  try {
    await access(join(dir, SKILL_FILE_NAME));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Finds every Skill directory under `root`: one holding a `SKILL.md`, found by walking up
 * to `SKILL_DISCOVERY_MAX_DEPTH` levels below it. A directory is never descended into once
 * it is found to hold one, so a Skill's own supporting directories are never mistaken for
 * Skills of their own. Version-control metadata, dependency directories, and dotfile
 * directories are skipped, via the same rule `isExcludedPath` applies to a Skill's own files.
 *
 * @param root - Where to start looking.
 * @returns Absolute paths of every directory found to hold a `SKILL.md`, sorted for
 * deterministic reporting. If `root` itself holds one, that is the only entry and the walk
 * does not run any further.
 */
async function discoverSkillDirectories(root: string): Promise<string[]> {
  if (await holdsSkillFile(root)) return [root];

  const found: string[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || isExcludedPath(entry.name)) continue;
      const absolutePath = join(dir, entry.name);
      if (await holdsSkillFile(absolutePath)) {
        found.push(absolutePath);
      } else if (depth < SKILL_DISCOVERY_MAX_DEPTH) {
        await walk(absolutePath, depth + 1);
      }
    }
  };

  await walk(root, 1);
  return found.sort();
}

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

  // One presigned destination per declared file, in the order the manifest
  // declared them (ADR-0032), so the two lists line up index for index.
  await Promise.all(
    published.upload.files.map((target, index) => {
      const file = bundle.files[index];
      if (!file || file.path !== target.path) {
        throw new Error("The Registry returned upload targets that do not match the files it was told about.");
      }
      return uploadArtifactFile(fetchImpl, target, file.bytes);
    }),
  );

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
 * Publishes the Skill at a directory, or every Skill beneath it.
 *
 * @param deps - The fetch implementation, config-file path, environment, the directory a
 * relative `options.path` is resolved against, whether a terminal is attached, and how to
 * confirm publishing more than one Skill.
 * @param options - Where to look; defaults to `deps.cwd`. `yes` skips the confirmation
 * before publishing more than one Skill, for automation with no terminal attached.
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
  const targetPath = options.path ? resolve(deps.cwd, options.path) : deps.cwd;

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

  const bundles = await buildBundles(targetPath, directories);

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
