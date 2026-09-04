import { describe, expect, it } from "bun:test";
import { access, lstat, mkdtemp, readFile, readlink, rm } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { installSkill, sanitizeSkillDirectoryName } from "../src/install.js";

const encoder = new TextEncoder();

const files = [
  { path: "SKILL.md", bytes: encoder.encode("---\nname: code-review\ndescription: Reviews code.\n---\nBody.\n") },
  { path: "scripts/run.sh", bytes: encoder.encode("echo hi") },
];

/** Separate roots so a "project" install and a "user" install can never be confused for one another. */
async function withTempRoots<T>(run: (roots: { cwd: string; homeDir: string }) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), "skillreg-install-cwd-"));
  const homeDir = await mkdtemp(join(tmpdir(), "skillreg-install-home-"));
  try {
    return await run({ cwd, homeDir });
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("installSkill — canonical directory (ADR-0022)", () => {
  it("always writes the Skill's files into .agents/skills, whichever Agent is chosen", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const report = await installSkill({ cwd, env: {}, homeDir }, "code-review", files, "project", "claude-code", {
        copy: false,
      });

      const canonical = join(cwd, ".agents", "skills", "code-review");
      expect(report.skillDirectory).toBe(canonical);
      expect(await readFile(join(canonical, "SKILL.md"), "utf8")).toContain("code-review");
      expect(await readFile(join(canonical, "scripts", "run.sh"), "utf8")).toBe("echo hi");
    });
  });

  it("a universal Agent reads .agents/skills directly — no second link", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const report = await installSkill({ cwd, env: {}, homeDir }, "code-review", files, "project", "codex", {
        copy: false,
      });

      expect(report.link).toEqual({ kind: "canonical" });
      expect(await exists(join(cwd, ".codex"))).toBe(false);
    });
  });
});

describe("installSkill — alsoServes names the other Agents a directory already serves", () => {
  it("is empty for an Agent whose directory nothing else shares", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const report = await installSkill({ cwd, env: {}, homeDir }, "code-review", files, "project", "claude-code", {
        copy: false,
      });

      expect(report.alsoServes).toEqual([]);
    });
  });

  it("names a sibling Agent that coincidentally shares the same directory of its own", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const report = await installSkill({ cwd, env: {}, homeDir }, "code-review", files, "project", "qoder", {
        copy: false,
      });

      expect(report.alsoServes).toEqual(["qoder-cn"]);
    });
  });

  it("names every other Agent reading the canonical directory directly", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const report = await installSkill({ cwd, env: {}, homeDir }, "code-review", files, "project", "codex", {
        copy: false,
      });

      expect(report.alsoServes.length).toBeGreaterThan(1);
      expect(report.alsoServes).toContain("cline");
      expect(report.alsoServes).not.toContain("codex");
    });
  });
});

describe("installSkill — non-universal Agents get a symlink", () => {
  it("symlinks .claude/skills/<name> at the canonical copy at project scope", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const report = await installSkill({ cwd, env: {}, homeDir }, "code-review", files, "project", "claude-code", {
        copy: false,
      });

      const linkPath = join(cwd, ".claude", "skills", "code-review");
      expect(report.link).toEqual({ kind: "symlink", path: linkPath });
      expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
      // Relative on POSIX, so the tree stays portable; a Windows junction needs an
      // absolute target instead (`symlinkInto`'s own doc comment explains why).
      const canonicalTarget = join(cwd, ".agents", "skills", "code-review");
      const expectedLinkTarget = platform() === "win32" ? canonicalTarget : join("..", "..", ".agents", "skills", "code-review");
      expect(await readlink(linkPath)).toBe(expectedLinkTarget);
      // The link resolves to the real files.
      expect(await readFile(join(linkPath, "SKILL.md"), "utf8")).toContain("code-review");
    });
  });

  it("honours the Agent's own configuration-directory override at user scope", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const custom = join(homeDir, "custom-claude");
      const report = await installSkill(
        { cwd, env: { CLAUDE_CONFIG_DIR: custom }, homeDir },
        "code-review",
        files,
        "user",
        "claude-code",
        { copy: false },
      );

      expect(report.skillDirectory).toBe(join(homeDir, ".agents", "skills", "code-review"));
      expect(report.link).toEqual({ kind: "symlink", path: join(custom, "skills", "code-review") });
      expect(await readFile(join(custom, "skills", "code-review", "SKILL.md"), "utf8")).toContain("code-review");
      expect(await exists(join(homeDir, ".claude"))).toBe(false);
    });
  });

  it("pi is asymmetric — .pi/skills at project, .pi/agent/skills at user", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const projectReport = await installSkill({ cwd, env: {}, homeDir }, "code-review", files, "project", "pi", {
        copy: false,
      });
      expect(projectReport.link).toEqual({ kind: "symlink", path: join(cwd, ".pi", "skills", "code-review") });

      const userReport = await installSkill({ cwd, env: {}, homeDir }, "code-review", files, "user", "pi", {
        copy: false,
      });
      expect(userReport.link).toEqual({ kind: "symlink", path: join(homeDir, ".pi", "agent", "skills", "code-review") });
    });
  });
});

describe("installSkill — --copy", () => {
  it("writes a real directory into the Agent's own path instead of a symlink", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const report = await installSkill({ cwd, env: {}, homeDir }, "code-review", files, "project", "claude-code", {
        copy: true,
      });

      const linkPath = join(cwd, ".claude", "skills", "code-review");
      expect(report.link).toEqual({ kind: "copy", path: linkPath, reason: "requested" });
      expect((await lstat(linkPath)).isSymbolicLink()).toBe(false);
      expect(await readFile(join(linkPath, "SKILL.md"), "utf8")).toContain("code-review");
      // The canonical copy still exists too.
      expect(await exists(join(cwd, ".agents", "skills", "code-review", "SKILL.md"))).toBe(true);
    });
  });
});

describe("installSkill — user scope for an Agent with no user directory", () => {
  it("refuses rather than guessing a location", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      await expect(
        installSkill({ cwd, env: {}, homeDir }, "code-review", files, "user", "eve", { copy: false }),
      ).rejects.toThrow(/no user-level skills directory/);
    });
  });
});

describe("installSkill — housekeeping", () => {
  it("sanitises the Skill's name before using it as a directory name", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const report = await installSkill({ cwd, env: {}, homeDir }, "../../Escape Me", files, "project", "codex", {
        copy: false,
      });

      expect(report.skillDirectory).toBe(join(cwd, ".agents", "skills", "escape-me"));
      expect(await exists(join(cwd, "..", "..", "SKILL.md"))).toBe(false);
    });
  });

  it("re-running for the same Skill overwrites cleanly", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      await installSkill({ cwd, env: {}, homeDir }, "code-review", files, "project", "codex", { copy: false });

      const secondFiles = [
        { path: "SKILL.md", bytes: encoder.encode("---\nname: code-review\ndescription: Updated.\n---\nNew body.\n") },
      ];
      const report = await installSkill({ cwd, env: {}, homeDir }, "code-review", secondFiles, "project", "codex", {
        copy: false,
      });

      expect(await readFile(join(report.skillDirectory, "SKILL.md"), "utf8")).toContain("Updated.");
      expect(await exists(join(report.skillDirectory, "scripts", "run.sh"))).toBe(false);
    });
  });

  it("re-running switches a stale symlink for the fresh one", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      await installSkill({ cwd, env: {}, homeDir }, "code-review", files, "project", "claude-code", { copy: false });
      const report = await installSkill({ cwd, env: {}, homeDir }, "code-review", files, "project", "claude-code", {
        copy: false,
      });

      const linkPath = join(cwd, ".claude", "skills", "code-review");
      expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
      expect(report.link).toEqual({ kind: "symlink", path: linkPath });
    });
  });
});

describe("sanitizeSkillDirectoryName", () => {
  const cases: Array<[string, string]> = [
    ["code-review", "code-review"],
    ["Code Review!", "code-review"],
    ["../../etc/passwd", "etc-passwd"],
    ["C:\\Windows\\System32", "c-windows-system32"],
    ["..", ""],
    [".", ""],
    ["with\0null", "with-null"],
    ["--leading-and-trailing--", "leading-and-trailing"],
  ];

  for (const [input, expected] of cases) {
    if (expected === "") {
      it(`refuses ${JSON.stringify(input)}, which leaves nothing usable`, () => {
        expect(() => sanitizeSkillDirectoryName(input)).toThrow(/no characters usable/);
      });
    } else {
      it(`${JSON.stringify(input)} -> ${expected}`, () => {
        expect(sanitizeSkillDirectoryName(input)).toBe(expected);
      });
    }
  }

  it("never returns a name ending in a hyphen, even when the length cap falls on one", () => {
    const long = `${"a".repeat(63)}-bbbb`;
    const sanitized = sanitizeSkillDirectoryName(long);
    expect(sanitized).toBe("a".repeat(63));
    expect(sanitized.length).toBeLessThanOrEqual(64);
  });
});
