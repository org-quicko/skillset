import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, sep } from "node:path";
import {
  buildSkillBundle,
  formatSkillValidationError,
  importNamespace,
  isExcludedPath,
  parseSkillDocument,
  parseSkillSourceUrl,
  resourceSourceUrl,
  SKILL_DISCOVERY_MAX_DEPTH,
  SKILL_FILE_NAME,
  SkillValidationError,
  type SkillBundle,
  type SkillFile,
  type SkillSourceLocation,
} from "@in-org-quicko/skillset-shared";

/*
 * Reading Skills off disk and out of repositories — shared by the CLI and the
 * MCP server, so a path or a URL means the same thing to both (ADR-0044).
 */

/**
 * Reads every file under `root`, skipping whatever `isExcludedPath` (shared)
 * would exclude anyway — pruning descent into `node_modules`/`.git`/etc.
 * rather than reading them and discarding the bytes.
 */
export async function walkSkillDirectory(root: string, dir: string = root): Promise<SkillFile[]> {
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
export async function holdsSkillFile(dir: string): Promise<boolean> {
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
export async function discoverSkillDirectories(root: string): Promise<string[]> {
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

/** A shallow checkout of a repository, and how to get rid of it. */
export interface Checkout {
  /** The directory the location's folder was checked out to — the clone's root joined with `location.path`. */
  folder: string;
  /** Deletes the whole clone. Safe to call more than once. */
  cleanup(): Promise<void>;
}

/** Runs one git command, rejecting with git's own stderr so an auth failure reads as git wrote it. */
function git(args: readonly string[], env: NodeJS.ProcessEnv, cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, env, windowsHide: true }, (error, _stdout, stderr) => {
      if (!error) return resolve();
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return reject(new Error("git was not found on PATH — installing from a URL needs git."));
      }
      reject(new Error(stderr.trim() || error.message));
    });
  });
}

/**
 * Checks out just the folder a Git Provider location names, as the User's own
 * git would.
 *
 * @param location - The provider, project, ref, and folder, from
 * `parseSkillSourceUrl`.
 * @param env - The environment git runs under. Passed through whole, so
 * whatever the User's git is configured with — a credential helper, an
 * `insteadOf` rewrite to SSH — applies exactly as it would to their own
 * `git clone`.
 * @returns Where the folder is on disk, and a `cleanup` that deletes the clone.
 * @throws Error with git's own message when the clone fails — the repository
 * does not exist, the User's credentials cannot read it, or the ref is not a
 * branch or tag — or when git is not installed.
 *
 * @remarks
 * Shallow, blob-less, and sparse, so a monorepo costs one commit's worth of
 * the one folder rather than its history (ADR-0044). The clone runs as the
 * User, which is the entire reason this exists rather than the anonymous API
 * walk: a private repository the User can clone is one this can read, with
 * no credential passing through this CLI at all.
 *
 * `GIT_TERMINAL_PROMPT=0` makes a missing credential fail rather than wait on
 * a prompt nobody can see, since git's output is captured here rather than
 * shown. A credential helper still runs.
 *
 * `--branch` takes a branch or a tag, not a commit SHA; a tree URL at a SHA is
 * refused by git with a message saying so.
 *
 * @example
 * ```ts
 * const checkout = await checkoutFolder(parseSkillSourceUrl(url), process.env);
 * try {
 *   const files = await walkSkillDirectory(checkout.folder);
 * } finally {
 *   await checkout.cleanup();
 * }
 * ```
 */
export async function checkoutFolder(location: SkillSourceLocation, env: NodeJS.ProcessEnv): Promise<Checkout> {
  const root = await mkdtemp(join(tmpdir(), "skillset-clone-"));
  const cleanup = () => rm(root, { recursive: true, force: true });
  const gitEnv = { ...env, GIT_TERMINAL_PROMPT: "0" };

  try {
    const args = ["clone", "--depth", "1", "--filter=blob:none", "--quiet"];
    // Sparse only when there is a folder to narrow to: a sparse clone of the
    // root checks out the root's files and none of its directories.
    if (location.path) args.push("--sparse");
    if (location.ref) args.push("--branch", location.ref);
    args.push(`${resourceSourceUrl(location)}.git`, root);
    await git(args, gitEnv);

    if (location.path) await git(["sparse-checkout", "set", location.path], gitEnv, root);
  } catch (error) {
    await cleanup();
    throw error;
  }

  return { folder: location.path ? join(root, ...location.path.split("/")) : root, cleanup };
}

/** A spinner, or anything shaped like one — how a slow step reports itself. */
export interface Progress {
  start(message: string): void;
  stop(message: string): void;
  fail(message: string): void;
}

/** One Skill read out of a repository, ready to install or publish. */
export interface RepositorySkill {
  /** The name, request body, and files — the Source already set on the request. */
  bundle: SkillBundle;
  /** `owner/repo`, the Namespace the Registry will derive from the same Source (ADR-0042). */
  namespace: string;
}

/** Whether a command's argument is a repository URL rather than a Registry name or a path. */
export function isRepositoryUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/**
 * The `name` a Skill directory's `SKILL.md` declares, which is what `--name`
 * matches against.
 *
 * @remarks
 * Falls back to the folder's name when the frontmatter does not parse, so one
 * broken Skill elsewhere in a repository neither blocks choosing a good one
 * nor disappears from the list a miss prints. The chosen Skill is still held
 * to the full rules by `buildSkillBundle` afterwards.
 */
async function declaredName(dir: string): Promise<string> {
  try {
    return parseSkillDocument(await readFile(join(dir, SKILL_FILE_NAME), "utf8")).name;
  } catch {
    return basename(dir);
  }
}

/**
 * Reads one named Skill out of a GitHub or GitLab repository, through a
 * checkout made with the User's own git.
 *
 * @param url - A repository URL, a tree at a ref, or a folder within one.
 * @param skillName - `--name`: the `name` the Skill's `SKILL.md` declares —
 * the name it is installed and published under, which need not match its
 * folder.
 * @param env - The environment git runs under, so the User's own credential
 * helpers and URL rewrites apply (ADR-0044).
 * @param progress - Reports the clone, which is the slow part.
 * @returns The Skill's bundle, with the repository recorded as its Source,
 * and the Namespace that Source gives it.
 * @throws Error when the URL is not a Git Provider's; when git cannot clone
 * it; when the folder does not exist at that ref or holds no Skill; when no
 * Skill there declares `skillName`, naming every one that does exist; or,
 * naming the rule, when the Skill fails the checks a publish holds it to.
 *
 * @remarks
 * Shared by `install` and `publish`, so a URL means the same thing to both.
 * The checkout is deleted before this returns, whether or not it succeeds.
 *
 * @example
 * ```ts
 * const { bundle, namespace } = await readRepositorySkill("https://github.com/acme/skills", "pdf", process.env);
 * ```
 */
export async function readRepositorySkill(
  url: string,
  skillName: string,
  env: NodeJS.ProcessEnv,
  progress?: Progress,
): Promise<RepositorySkill> {
  const location = parseSkillSourceUrl(url);
  const source = resourceSourceUrl(location);
  progress?.start(`Cloning ${source}`);
  let checkout;
  try {
    checkout = await checkoutFolder(location, env);
  } catch (error) {
    progress?.fail(`Could not clone ${source}`);
    throw error;
  }
  progress?.stop(`Cloned ${source}`);

  let files;
  try {
    if (!existsSync(checkout.folder)) throw new Error(`${url}: that folder does not exist at this ref.`);
    const directories = await discoverSkillDirectories(checkout.folder);
    if (directories.length === 0) {
      throw new Error(`No Skill found at ${url} — looked for a directory holding ${SKILL_FILE_NAME}.`);
    }
    const found = await Promise.all(directories.map(async (dir) => ({ dir, name: await declaredName(dir) })));
    const chosen = found.find((skill) => skill.name === skillName);
    if (!chosen) {
      const names = found.map((skill) => skill.name).sort().join(", ");
      throw new Error(`No Skill named "${skillName}" at ${url} — found: ${names}.`);
    }
    files = await walkSkillDirectory(chosen.dir);
  } finally {
    await checkout.cleanup();
  }

  let bundle;
  try {
    bundle = buildSkillBundle(files, { source });
  } catch (error) {
    if (error instanceof SkillValidationError) throw new Error(formatSkillValidationError(error));
    throw error;
  }
  return { bundle, namespace: importNamespace(location) };
}
