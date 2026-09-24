import { randomUUID } from "node:crypto";
import { cp, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import { basename, dirname, join, normalize, relative } from "node:path";
import {
  agentSkillsDir,
  agentsSharingDirectory,
  canonicalSkillsDir,
  getAgent,
  SKILL_NAME_MAX_LENGTH,
  type AgentId,
  type Scope,
  type SkillFile,
} from "@in-org-quicko/skillset-shared";

/** How the chosen Agent's own directory was pointed at the canonical `.agents/skills` copy. */
export type LinkResult =
  | { kind: "canonical" }
  | { kind: "symlink"; path: string }
  | { kind: "copy"; path: string; reason: "requested" | "symlink-failed" };

export interface WriteReport {
  /** Where the Skill's files were written — always `<canonical .agents/skills>/<name>` (ADR-0022). */
  skillDirectory: string;
  /** The Agent that was chosen, or `null` when none was — a canonical-only install that links nothing. */
  agent: AgentId | null;
  /** Whether that Agent reads the canonical directory directly, or via a symlink/copy. */
  link: LinkResult;
  /**
   * Every other Agent that reads Skills from the same directory `agent` does, at this
   * install's Scope — `[]` if none. This install already serves them too.
   */
  alsoServes: AgentId[];
}

export interface InstallContext {
  cwd: string;
  env: Record<string, string | undefined>;
  homeDir: string;
}

export interface InstallOptions {
  /** Copy the Skill into the Agent's own directory instead of symlinking to the canonical copy. */
  copy: boolean;
}

/**
 * Reduces a Skill's name to something safe to use as a single directory name.
 *
 * The name arrives from the Registry, and `install` is the one place a hostile Artifact is
 * stopped (ticket 09), so it is treated as untrusted here rather than assumed to have
 * survived the publish-time rules: everything outside `a-z0-9-` becomes a hyphen, which
 * disposes of path separators, drive letters, `.`, and `..` in one pass.
 *
 * @param name - The Skill's name as the Registry reported it.
 * @returns A lowercase, hyphen-separated directory name of at most
 * `SKILL_NAME_MAX_LENGTH` characters.
 * @throws Error when nothing usable survives sanitisation, rather than falling back to a
 * directory name the caller never chose.
 *
 * @example
 * ```ts
 * sanitizeSkillDirectoryName("../../etc/passwd"); // "etc-passwd"
 * sanitizeSkillDirectoryName("Code Review!");     // "code-review"
 * ```
 */
export function sanitizeSkillDirectoryName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SKILL_NAME_MAX_LENGTH)
    .replace(/-+$/, "");

  if (!sanitized) {
    throw new Error(`Skill name "${name}" has no characters usable as a directory name.`);
  }
  return sanitized;
}

/**
 * Writes `files` into a staging directory beside `targetDir` — under its own parent, so every
 * move below is a same-filesystem rename rather than a cross-filesystem copy — then swaps it
 * onto `targetDir`: the previous directory, if any, is renamed aside rather than deleted, the
 * staged one is renamed into its place, and only then is the previous directory discarded. If
 * that second rename fails, the previous directory is renamed back rather than left missing —
 * without this, a rename failing right after the old directory was removed (a transient
 * Windows lock from an antivirus scan or the search indexer is the ordinary case) would leave
 * neither the old Skill nor the new one at the target.
 *
 * Both temporary directories are prefixed with `.`, which the Skill name sanitiser
 * ({@link sanitizeSkillDirectoryName}) never produces, so a leftover from an interrupted run
 * cannot collide with, or be mistaken for, a real Skill directory.
 *
 * @throws Error when a file cannot be written, or when the swap itself fails; `targetDir` is
 * left exactly as it was found, and both temporary directories are removed before the error
 * propagates.
 */
async function writeSkillFiles(targetDir: string, files: SkillFile[]): Promise<void> {
  const parent = dirname(targetDir);
  const stagingDir = join(parent, `.skillset-staging-${basename(targetDir)}-${randomUUID()}`);
  const trashDir = join(parent, `.skillset-trash-${basename(targetDir)}-${randomUUID()}`);

  try {
    await mkdir(stagingDir, { recursive: true });
    for (const file of files) {
      const filePath = join(stagingDir, ...file.path.split("/"));
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, file.bytes);
    }

    const hadPrevious = await rename(targetDir, trashDir).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return false;
      },
    );

    try {
      await rename(stagingDir, targetDir);
    } catch (error) {
      if (hadPrevious) {
        await rename(trashDir, targetDir).catch(() => {});
      }
      throw error;
    }
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
    await rm(trashDir, { recursive: true, force: true });
  }
}

/** Clears whatever is at `path` — a stale directory, symlink, or file — and ensures its parent exists. */
async function clearTarget(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
  await mkdir(dirname(path), { recursive: true });
}

/**
 * Points `linkPath` at `canonicalTarget` with a symlink — relative on POSIX so the tree
 * stays portable, a junction on Windows where an unprivileged symlink is refused and a
 * junction needs an absolute target.
 *
 * @throws Error when the platform refuses the link (Windows without Developer Mode, a
 * filesystem with no symlink support); the caller falls back to a copy.
 */
async function symlinkInto(linkPath: string, canonicalTarget: string): Promise<void> {
  await clearTarget(linkPath);
  if (platform() === "win32") {
    await symlink(canonicalTarget, linkPath, "junction");
  } else {
    await symlink(relative(dirname(linkPath), canonicalTarget), linkPath);
  }
}

async function copyInto(linkPath: string, canonicalTarget: string): Promise<void> {
  await clearTarget(linkPath);
  await cp(canonicalTarget, linkPath, { recursive: true });
}

export interface ResolvedInstallTarget {
  /** The Skill's name, sanitised into a single safe directory name. */
  directoryName: string;
  /** The canonical `.agents/skills` directory at `scope`, before `directoryName` is appended. */
  canonicalDir: string;
  /** Where the Skill's files would be written — always `<canonicalDir>/<directoryName>`. */
  canonicalTarget: string;
  /**
   * The configured Agent's own directory at `scope` — `null` when the Agent has none there, and
   * equal to `canonicalDir` when `agentId` was `null` (a canonical-only install that links
   * nothing).
   */
  agentDir: string | null;
}

/**
 * Resolves where a Skill's files would land, without touching the filesystem — the one
 * computation `installSkill` and a caller that needs to check for an existing install (the
 * MCP server's `install_skills`, which refuses rather than overwriting by default) both need, so
 * neither reimplements it.
 *
 * @param ctx - Project root, environment, and home directory to resolve directories against.
 * `ctx.env` supplies an Agent's own configuration-directory override.
 * @param skillName - The Skill's name as the Registry reported it; sanitised here via
 * {@link sanitizeSkillDirectoryName} before it becomes a directory name.
 * @param scope - "project" to resolve under `ctx.cwd`, "user" for the per-User canonical
 * directory and the Agent's per-User directory.
 * @param agentId - The Agent to resolve a target for, or `null` for a canonical-only install
 * that links nothing (the detection ladder's fallback) — then `agentDir` is `canonicalDir`.
 * @returns The sanitised directory name, the canonical directory and target it resolves to,
 * and the configured Agent's own directory at `scope` (`null` when it has none there).
 * @throws Error when `skillName` sanitises to nothing (via {@link sanitizeSkillDirectoryName}),
 * or when `agentId` names no Agent.
 *
 * @example
 * ```ts
 * resolveInstallTarget({ cwd, env: {}, homeDir }, "code-review", "project", "claude-code");
 * // -> { directoryName: "code-review", canonicalDir: "<cwd>/.agents/skills",
 * //      canonicalTarget: "<cwd>/.agents/skills/code-review", agentDir: "<cwd>/.claude/skills" }
 * ```
 */
export function resolveInstallTarget(
  ctx: InstallContext,
  skillName: string,
  scope: Scope,
  agentId: AgentId | null,
): ResolvedInstallTarget {
  const directoryName = sanitizeSkillDirectoryName(skillName);
  const resolveCtx = { env: ctx.env, homeDir: ctx.homeDir, projectRoot: ctx.cwd };

  // shared's paths are POSIX-style strings, possibly mixed with the host's own separator
  // once joined onto cwd — `normalize` understands both on every platform Node runs on.
  const canonicalDir = normalize(canonicalSkillsDir(scope, resolveCtx));
  const canonicalTarget = join(canonicalDir, directoryName);
  // `null` means "no Agent detected": write the canonical copy and link nothing, which the
  // `agentDir === canonicalDir` branch in `installSkill` already does.
  const agentDir = agentId === null ? canonicalDir : agentSkillsDir(agentId, scope, resolveCtx);

  return { directoryName, canonicalDir, canonicalTarget, agentDir };
}

/**
 * Installs a Skill: writes its files to the canonical `.agents/skills/<name>` directory,
 * then — for an Agent that reads somewhere else — points that Agent's own directory at the
 * canonical copy with a symlink (ADR-0022).
 *
 * @param ctx - Project root, environment, and home directory to resolve directories
 * against. `ctx.env` supplies an Agent's own configuration-directory override.
 * @param skillName - The Skill's name as the Registry reported it; sanitised here via
 * {@link sanitizeSkillDirectoryName} before it becomes a directory name.
 * @param files - The Skill's files, already validated by `extractSkillFiles`.
 * @param scope - "project" to install under `ctx.cwd`, "user" for the per-User canonical
 * directory and the Agent's per-User directory.
 * @param agentId - The Agent to install for, or `null` when detection identified none — the
 * files are written to the canonical directory and nothing is linked (`link.kind` is
 * `"canonical"`, `agent` is `null`, `alsoServes` is empty).
 * @param options - `copy: true` writes a real copy into the Agent's directory instead of a
 * symlink.
 * @returns Where the Skill's files live, the Agent chosen, how that Agent's directory was
 * linked to them, and which other Agents that same directory already serves.
 * @throws Error when `skillName` sanitises to nothing; when `agentId` names no Agent; when
 * `scope` is "user" for an Agent with no user-level directory (`eve`, `promptscript`); or
 * when the filesystem refuses a write.
 *
 * @remarks
 * A symlink that the platform refuses falls back to a copy rather than failing the install,
 * and the report says which happened.
 *
 * @example
 * ```ts
 * await installSkill({ cwd, env: process.env, homeDir: homedir() }, "code-review", files, "project", "claude-code", { copy: false });
 * // -> { skillDirectory: "<cwd>/.agents/skills/code-review", agent: "claude-code",
 * //      link: { kind: "symlink", path: "<cwd>/.claude/skills/code-review" }, alsoServes: [] }
 * ```
 */
export async function installSkill(
  ctx: InstallContext,
  skillName: string,
  files: SkillFile[],
  scope: Scope,
  agentId: AgentId | null,
  options: InstallOptions,
): Promise<WriteReport> {
  const resolveCtx = { env: ctx.env, homeDir: ctx.homeDir, projectRoot: ctx.cwd };
  const { directoryName, canonicalDir, canonicalTarget, agentDir } = resolveInstallTarget(ctx, skillName, scope, agentId);
  if (agentDir === null) {
    // agentId is non-null here: a `null` agentId resolves agentDir to canonicalDir, never null.
    throw new Error(`${getAgent(agentId as AgentId).displayName} has no user-level skills directory — install it at project scope instead.`);
  }
  const alsoServes = agentId === null ? [] : agentsSharingDirectory(agentId, scope, resolveCtx);

  await writeSkillFiles(canonicalTarget, files);

  if (normalize(agentDir) === canonicalDir) {
    return { skillDirectory: canonicalTarget, agent: agentId, link: { kind: "canonical" }, alsoServes };
  }

  const linkPath = join(normalize(agentDir), directoryName);
  if (options.copy) {
    await copyInto(linkPath, canonicalTarget);
    return { skillDirectory: canonicalTarget, agent: agentId, link: { kind: "copy", path: linkPath, reason: "requested" }, alsoServes };
  }

  try {
    await symlinkInto(linkPath, canonicalTarget);
    return { skillDirectory: canonicalTarget, agent: agentId, link: { kind: "symlink", path: linkPath }, alsoServes };
  } catch {
    await copyInto(linkPath, canonicalTarget);
    return {
      skillDirectory: canonicalTarget,
      agent: agentId,
      link: { kind: "copy", path: linkPath, reason: "symlink-failed" },
      alsoServes,
    };
  }
}

/** What {@link removeSkill} actually deleted, so a caller can report it precisely. */
export interface RemoveReport {
  /** The canonical directory that was removed, or `null` when there was nothing there. */
  skillDirectory: string | null;
  /** The Agent's own symlink or copy that was removed, or `null` when the Agent reads the canonical directory directly. */
  link: string | null;
}

/**
 * Removes an installed Skill: the canonical copy, and the Agent's own
 * symlink or copy pointing at it.
 *
 * @remarks
 * The inverse of {@link installSkill}, and deliberately forgiving — a Skill
 * half-removed by hand, or installed for a different Agent than the one
 * resolved now, should still come out rather than erroring on the first
 * path that is already gone. Each removal is independent, and a path that
 * does not exist is not a failure.
 *
 * The Agent's own path is only touched when it differs from the canonical
 * directory; where an Agent reads `.agents/skills` directly (ADR-0022),
 * removing the canonical copy has already removed it for that Agent, and
 * deleting `agentDir` itself would take every other Skill with it.
 *
 * Nothing here reads or writes the lockfile — the caller owns that, because
 * it also owns deciding whether the removal should have happened.
 *
 * @param ctx - Project root, environment, and home directory to resolve
 * against.
 * @param skillName - The Skill's name as the lockfile records it.
 * @param scope - Which Scope to remove from.
 * @param agentId - The Agent whose own directory to unlink, or `null` to
 * remove only the canonical copy.
 * @returns What was actually removed; `null` in a field means there was
 * nothing there to remove.
 * @throws Error when `skillName` sanitises to nothing, when `agentId` names
 * no Agent (both via {@link resolveInstallTarget}), or when a path exists
 * but cannot be deleted.
 * @example
 * ```ts
 * await removeSkill(ctx, "code-review", "project", "claude-code");
 * // -> { skillDirectory: "<cwd>/.agents/skills/code-review",
 * //      link: "<cwd>/.claude/skills/code-review" }
 * ```
 */
export async function removeSkill(
  ctx: InstallContext,
  skillName: string,
  scope: Scope,
  agentId: AgentId | null,
): Promise<RemoveReport> {
  const { directoryName, canonicalDir, canonicalTarget, agentDir } = resolveInstallTarget(ctx, skillName, scope, agentId);

  const removedCanonical = await removeIfPresent(canonicalTarget);

  // `agentDir === null` means this Agent has no directory at this Scope, so
  // there was never a link to remove — not an error on the way out, unlike
  // on the way in.
  if (agentDir === null || normalize(agentDir) === canonicalDir) {
    return { skillDirectory: removedCanonical ? canonicalTarget : null, link: null };
  }

  const linkPath = join(normalize(agentDir), directoryName);
  const removedLink = await removeIfPresent(linkPath);
  return { skillDirectory: removedCanonical ? canonicalTarget : null, link: removedLink ? linkPath : null };
}

/** Deletes `path` if it is there, reporting whether it was. `rm` with `force` cannot tell us, so the existence check is explicit. */
async function removeIfPresent(path: string): Promise<boolean> {
  try {
    await rm(path, { recursive: true });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export {
  forgetInstall,
  hashInstalledSkill,
  hashSkillFiles,
  LOCKFILE_NAME,
  LOCKFILE_VERSION,
  readInstalled,
  readLockfile,
  recordInstall,
  resolveLockfilePath,
  skillStatus,
  writeLockfile,
  type InstalledSkill,
  type Lockfile,
  type LockfileEntry,
  type RegistryLookup,
  type SkillStatus,
} from "./lockfile.js";

export {
  checkoutFolder,
  discoverSkillDirectories,
  holdsSkillFile,
  isRepositoryUrl,
  readRepositorySkill,
  walkSkillDirectory,
  type Checkout,
  type Progress,
  type RepositorySkill,
} from "./repository.js";
