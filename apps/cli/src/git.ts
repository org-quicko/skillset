import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resourceSourceUrl, type SkillSourceLocation } from "@in-org-quicko/skillset-shared";

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
