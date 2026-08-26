import { cp, mkdir, rm, symlink as realSymlink, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";
import { canonicalInstallDir, resolveInstallDir, type AgentId, type Scope, type SkillFile } from "@skill-registry/shared";

export interface WriteReport {
  directory: string;
  mode: "canonical" | "symlink" | "copy-fallback";
  agents: AgentId[];
}

export interface InstallContext {
  cwd: string;
  env: Record<string, string | undefined>;
  homeDir: string;
  /** Overridable only so tests can force the copy-fallback path deterministically; defaults to the real `fs/promises.symlink`. */
  symlink?: typeof realSymlink;
}

/** shared's paths are POSIX-style strings, possibly mixed with the host's own separator once joined onto `cwd` — `normalize` understands both on every platform Node runs on. */
function toOsPath(posixPath: string): string {
  return normalize(posixPath);
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

/** Symlinks `linkPath` to `targetPath` (a junction on Windows, since that needs no admin/Developer-Mode privilege), falling back to a recursive copy if anything about creating the link fails. */
async function ensureSymlink(linkPath: string, targetPath: string, symlinkImpl: typeof realSymlink): Promise<"symlink" | "copy-fallback"> {
  try {
    await rm(linkPath, { recursive: true, force: true });
    await mkdir(dirname(linkPath), { recursive: true });
    if (process.platform === "win32") {
      await symlinkImpl(targetPath, linkPath, "junction");
    } else {
      await symlinkImpl(relative(dirname(linkPath), targetPath), linkPath);
    }
    return "symlink";
  } catch {
    await rm(linkPath, { recursive: true, force: true }).catch(() => {});
    await mkdir(dirname(linkPath), { recursive: true });
    await cp(targetPath, linkPath, { recursive: true });
    return "copy-fallback";
  }
}

/**
 * Writes a Skill once to the canonical (`generic`) directory, then symlinks — or, on
 * failure, copies — every other selected Agent's directory to it (docs/adr/0014). Agents
 * that resolve to the same directory as another selected Agent (or as canonical itself)
 * are grouped, so the work and the report both happen once per distinct directory.
 */
export async function installSkill(
  ctx: InstallContext,
  skillName: string,
  files: SkillFile[],
  scope: Scope,
  agentIds: AgentId[],
): Promise<WriteReport[]> {
  const resolveCtx = { env: ctx.env, homeDir: ctx.homeDir, projectRoot: ctx.cwd };
  const canonicalBase = toOsPath(canonicalInstallDir(scope, resolveCtx));
  const canonicalSkillDir = join(canonicalBase, skillName);

  await writeSkillFiles(canonicalSkillDir, files);

  const groups = new Map<string, AgentId[]>();
  for (const agentId of agentIds) {
    const dir = toOsPath(resolveInstallDir(agentId, scope, resolveCtx));
    const list = groups.get(dir);
    if (list) list.push(agentId);
    else groups.set(dir, [agentId]);
  }

  const symlinkImpl = ctx.symlink ?? realSymlink;
  const reports: WriteReport[] = [];
  for (const [dir, agents] of groups) {
    const agentSkillDir = join(dir, skillName);

    if (dir === canonicalBase) {
      reports.push({ directory: agentSkillDir, mode: "canonical", agents });
      continue;
    }

    const mode = await ensureSymlink(agentSkillDir, canonicalSkillDir, symlinkImpl);
    reports.push({ directory: agentSkillDir, mode, agents });
  }

  return reports;
}
