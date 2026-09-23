import { access, readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { isExcludedPath, SKILL_DISCOVERY_MAX_DEPTH, SKILL_FILE_NAME, type SkillFile } from "@in-org-quicko/skillset-shared";

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
