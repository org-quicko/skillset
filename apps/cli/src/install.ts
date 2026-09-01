import { cp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import { dirname, join, normalize, relative } from "node:path";
import {
  agentSkillsDir,
  canonicalSkillsDir,
  getAgent,
  SKILL_NAME_MAX_LENGTH,
  type AgentId,
  type Scope,
  type SkillFile,
} from "@skill-registry/shared";

/** How the chosen Agent's own directory was pointed at the canonical `.agents/skills` copy. */
export type LinkResult =
  | { kind: "canonical" }
  | { kind: "symlink"; path: string }
  | { kind: "copy"; path: string; reason: "requested" | "symlink-failed" };

export interface WriteReport {
  /** Where the Skill's files were written — always `<canonical .agents/skills>/<name>` (ADR-0022). */
  skillDirectory: string;
  /** The Agent that was chosen. */
  agent: AgentId;
  /** Whether that Agent reads the canonical directory directly, or via a symlink/copy. */
  link: LinkResult;
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
 * The name arrives from the Registry, and `add` is the one place a hostile Artifact is
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

async function writeSkillFiles(targetDir: string, files: SkillFile[]): Promise<void> {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  for (const file of files) {
    const filePath = join(targetDir, ...file.path.split("/"));
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.bytes);
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
 * @param agentId - The Agent to install for.
 * @param options - `copy: true` writes a real copy into the Agent's directory instead of a
 * symlink.
 * @returns Where the Skill's files live, the Agent chosen, and how that Agent's directory
 * was linked to them.
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
 * //      link: { kind: "symlink", path: "<cwd>/.claude/skills/code-review" } }
 * ```
 */
export async function installSkill(
  ctx: InstallContext,
  skillName: string,
  files: SkillFile[],
  scope: Scope,
  agentId: AgentId,
  options: InstallOptions,
): Promise<WriteReport> {
  const directoryName = sanitizeSkillDirectoryName(skillName);
  const resolveCtx = { env: ctx.env, homeDir: ctx.homeDir, projectRoot: ctx.cwd };

  const agentDir = agentSkillsDir(agentId, scope, resolveCtx);
  if (agentDir === null) {
    throw new Error(`${getAgent(agentId).displayName} has no user-level skills directory — install it at project scope instead.`);
  }

  // shared's paths are POSIX-style strings, possibly mixed with the host's own separator
  // once joined onto cwd — `normalize` understands both on every platform Node runs on.
  const canonicalDir = normalize(canonicalSkillsDir(scope, resolveCtx));
  const canonicalTarget = join(canonicalDir, directoryName);
  await writeSkillFiles(canonicalTarget, files);

  if (normalize(agentDir) === canonicalDir) {
    return { skillDirectory: canonicalTarget, agent: agentId, link: { kind: "canonical" } };
  }

  const linkPath = join(normalize(agentDir), directoryName);
  if (options.copy) {
    await copyInto(linkPath, canonicalTarget);
    return { skillDirectory: canonicalTarget, agent: agentId, link: { kind: "copy", path: linkPath, reason: "requested" } };
  }

  try {
    await symlinkInto(linkPath, canonicalTarget);
    return { skillDirectory: canonicalTarget, agent: agentId, link: { kind: "symlink", path: linkPath } };
  } catch {
    await copyInto(linkPath, canonicalTarget);
    return { skillDirectory: canonicalTarget, agent: agentId, link: { kind: "copy", path: linkPath, reason: "symlink-failed" } };
  }
}
