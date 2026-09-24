import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const REPO_URL = "https://github.com/acme/skills";
export const PDF_MD = "---\nname: pdf\ndescription: Reads PDFs.\n---\nBody.\n";

/**
 * Builds `acme/skills` as a bare repository on disk, holding two Skills under
 * `skills/` — one of them in a folder named differently from the Skill, so
 * `--name` is shown to match the frontmatter rather than the path.
 *
 * @returns The directory holding it, which {@link gitEnv} rewrites
 * `https://github.com/` to — so a test runs the real git clone, and nothing
 * touches the network. The caller deletes it.
 */
export async function createSkillsRepository(): Promise<string> {
  const remotes = await mkdtemp(join(tmpdir(), "skillset-remotes-"));
  const work = join(remotes, "work");
  await mkdir(join(work, "skills", "pdf", "references"), { recursive: true });
  await mkdir(join(work, "skills", "word-documents"), { recursive: true });
  await writeFile(join(work, "skills", "pdf", "SKILL.md"), PDF_MD);
  await writeFile(join(work, "skills", "pdf", "references", "forms.md"), "Forms.\n");
  await writeFile(join(work, "skills", "word-documents", "SKILL.md"), "---\nname: docx\ndescription: Writes documents.\n---\nBody.\n");

  const run = (args: string[], cwd: string) => execFileSync("git", args, { cwd, stdio: "pipe" });
  run(["init", "--quiet", "--initial-branch=main"], work);
  run(["add", "."], work);
  run(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", "skills"], work);
  await mkdir(join(remotes, "acme"), { recursive: true });
  run(["clone", "--quiet", "--bare", work, join(remotes, "acme", "skills.git")], remotes);
  return remotes;
}

/**
 * The process environment with `https://github.com/` rewritten to `remotes`,
 * any `SKILLSET_*` of the developer's own dropped, and `extra` laid over it.
 */
export function gitEnv(remotes: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("SKILLSET_")));
  return {
    ...base,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.file:///${remotes.replaceAll("\\", "/")}/.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/",
    ...extra,
  };
}
