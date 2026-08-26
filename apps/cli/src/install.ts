import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import {
  agentsSharingInstallDir,
  resolveInstallDir,
  SKILL_NAME_MAX_LENGTH,
  type AgentId,
  type Scope,
  type SkillFile,
} from "@skill-registry/shared";

export interface WriteReport {
  directory: string;
  /** Every Agent that reads `directory`, not only the one chosen — one install can serve several (ADR-0006). */
  agents: AgentId[];
}

export interface InstallContext {
  cwd: string;
  env: Record<string, string | undefined>;
  homeDir: string;
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

/**
 * Writes a Skill into the directory the chosen Agent actually reads from, replacing any
 * previous install of the same Skill there.
 *
 * Nothing is written anywhere else: the Skill lands in one directory, the one the User
 * chose, so `add` can never quietly populate a directory other Agents read. When that
 * directory happens to serve several Agents, the report names them all.
 *
 * @param ctx - Project root, environment, and home directory to resolve the Agent's
 * directory against. `ctx.env` supplies the Agent's own configuration-directory override.
 * @param skillName - The Skill's name as the Registry reported it; sanitised here via
 * {@link sanitizeSkillDirectoryName} before it becomes a directory name.
 * @param files - The Skill's files, already validated by `extractSkillFiles`.
 * @param scope - "project" to install under `ctx.cwd`, "user" for the Agent's per-User
 * configuration directory.
 * @param agentId - The Agent to install for.
 * @returns Where the Skill was written and every Agent that reads that directory.
 * @throws Error when `skillName` sanitises to nothing, when `agentId` names no Agent in
 * the table, or when the filesystem refuses the write (permissions, a read-only volume).
 *
 * @example
 * ```ts
 * await installSkill({ cwd, env: process.env, homeDir: homedir() }, "code-review", files, "project", "codex");
 * // -> { directory: "<cwd>/.agents/skills/code-review", agents: ["codex", "github-copilot", "opencode", "generic"] }
 * ```
 */
export async function installSkill(
  ctx: InstallContext,
  skillName: string,
  files: SkillFile[],
  scope: Scope,
  agentId: AgentId,
): Promise<WriteReport> {
  const directoryName = sanitizeSkillDirectoryName(skillName);
  const resolveCtx = { env: ctx.env, homeDir: ctx.homeDir, projectRoot: ctx.cwd };

  // shared's paths are POSIX-style strings, possibly mixed with the host's own separator
  // once joined onto cwd — `normalize` understands both on every platform Node runs on.
  const targetDir = join(normalize(resolveInstallDir(agentId, scope, resolveCtx)), directoryName);
  await writeSkillFiles(targetDir, files);

  return { directory: targetDir, agents: agentsSharingInstallDir(agentId, scope, resolveCtx) };
}
