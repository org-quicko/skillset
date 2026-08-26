import { describe, expect, it } from "bun:test";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSkill } from "../src/install.js";

const encoder = new TextEncoder();

const files = [
  { path: "SKILL.md", bytes: encoder.encode("---\nname: code-review\ndescription: Reviews code.\n---\nBody.\n") },
  { path: "scripts/run.sh", bytes: encoder.encode("echo hi") },
];

async function withTempProject<T>(run: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), "skillreg-install-test-"));
  try {
    return await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

describe("installSkill", () => {
  it("writing to generic alone: canonical only, no symlink", async () => {
    await withTempProject(async (cwd) => {
      const reports = await installSkill({ cwd, env: {}, homeDir: cwd }, "code-review", files, "project", ["generic"]);

      const expectedDir = join(cwd, ".agents", "skills", "code-review");
      expect(reports).toEqual([{ directory: expectedDir, mode: "canonical", agents: ["generic"] }]);
      expect(await readFile(join(expectedDir, "SKILL.md"), "utf8")).toContain("code-review");
      expect((await lstat(expectedDir)).isDirectory()).toBe(true);
    });
  });

  it("writing to claude-code: a real symlink (or junction) pointing at canonical, readable through it", async () => {
    await withTempProject(async (cwd) => {
      const reports = await installSkill({ cwd, env: {}, homeDir: cwd }, "code-review", files, "project", ["claude-code"]);

      const canonicalDir = join(cwd, ".agents", "skills", "code-review");
      const linkDir = join(cwd, ".claude", "skills", "code-review");
      expect(reports).toEqual([{ directory: linkDir, mode: "symlink", agents: ["claude-code"] }]);

      const stats = await lstat(linkDir);
      expect(stats.isSymbolicLink() || stats.isDirectory()).toBe(true); // a Windows junction reports as a directory via lstat
      expect(await readFile(join(linkDir, "SKILL.md"), "utf8")).toBe(await readFile(join(canonicalDir, "SKILL.md"), "utf8"));
      expect(await readFile(join(linkDir, "scripts", "run.sh"), "utf8")).toBe("echo hi");
    });
  });

  it("codex and generic together at project scope: written once, reported for both", async () => {
    await withTempProject(async (cwd) => {
      const reports = await installSkill({ cwd, env: {}, homeDir: cwd }, "code-review", files, "project", ["codex", "generic"]);

      const expectedDir = join(cwd, ".agents", "skills", "code-review");
      expect(reports).toEqual([{ directory: expectedDir, mode: "canonical", agents: ["codex", "generic"] }]);
    });
  });

  it("falls back to a real copy when symlink creation fails", async () => {
    await withTempProject(async (cwd) => {
      const failingSymlink = (async () => {
        throw new Error("simulated symlink failure");
      }) as unknown as typeof import("node:fs/promises").symlink;

      const reports = await installSkill(
        { cwd, env: {}, homeDir: cwd, symlink: failingSymlink },
        "code-review",
        files,
        "project",
        ["claude-code"],
      );

      const linkDir = join(cwd, ".claude", "skills", "code-review");
      expect(reports).toEqual([{ directory: linkDir, mode: "copy-fallback", agents: ["claude-code"] }]);
      expect((await lstat(linkDir)).isSymbolicLink()).toBe(false);
      expect(await readFile(join(linkDir, "SKILL.md"), "utf8")).toContain("code-review");
      expect(await readFile(join(linkDir, "scripts", "run.sh"), "utf8")).toBe("echo hi");
    });
  });

  it("re-running installSkill for the same Skill overwrites cleanly", async () => {
    await withTempProject(async (cwd) => {
      await installSkill({ cwd, env: {}, homeDir: cwd }, "code-review", files, "project", ["generic"]);

      const secondFiles = [{ path: "SKILL.md", bytes: encoder.encode("---\nname: code-review\ndescription: Updated.\n---\nNew body.\n") }];
      await installSkill({ cwd, env: {}, homeDir: cwd }, "code-review", secondFiles, "project", ["generic"]);

      const canonicalDir = join(cwd, ".agents", "skills", "code-review");
      expect(await readFile(join(canonicalDir, "SKILL.md"), "utf8")).toContain("Updated.");
      await expect(readFile(join(canonicalDir, "scripts", "run.sh"), "utf8")).rejects.toThrow();
    });
  });
});
