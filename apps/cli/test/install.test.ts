import { describe, expect, it } from "bun:test";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentId, Scope } from "@skill-registry/shared";
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

/** The shared `.agents/skills` directory at project Scope (ADR-0006), reported for all four. */
const SHARES_AGENTS_DIR: AgentId[] = ["codex", "github-copilot", "opencode", "generic"];

interface Case {
  agent: AgentId;
  scope: Scope;
  /** Path segments below the project root ("project") or the home directory ("user"). */
  segments: string[];
  serves: AgentId[];
}

// Every Agent at every Scope — the whole table, since a wrong path here writes to a real
// directory nothing reads and the Skill simply never loads (ADR-0006).
const cases: Case[] = [
  { agent: "claude-code", scope: "project", segments: [".claude", "skills"], serves: ["claude-code"] },
  { agent: "claude-code", scope: "user", segments: [".claude", "skills"], serves: ["claude-code"] },
  { agent: "codex", scope: "project", segments: [".agents", "skills"], serves: SHARES_AGENTS_DIR },
  { agent: "codex", scope: "user", segments: [".codex", "skills"], serves: ["codex"] },
  { agent: "github-copilot", scope: "project", segments: [".agents", "skills"], serves: SHARES_AGENTS_DIR },
  { agent: "github-copilot", scope: "user", segments: [".copilot", "skills"], serves: ["github-copilot"] },
  { agent: "opencode", scope: "project", segments: [".agents", "skills"], serves: SHARES_AGENTS_DIR },
  { agent: "opencode", scope: "user", segments: [".config", "opencode", "skills"], serves: ["opencode"] },
  // pi is the one Agent whose two Scopes use different suffixes (ADR-0006).
  { agent: "pi", scope: "project", segments: [".pi", "skills"], serves: ["pi"] },
  { agent: "pi", scope: "user", segments: [".pi", "agent", "skills"], serves: ["pi"] },
  { agent: "generic", scope: "project", segments: [".agents", "skills"], serves: SHARES_AGENTS_DIR },
  { agent: "generic", scope: "user", segments: [".config", "agents", "skills"], serves: ["generic"] },
];

describe("installSkill — every Agent and Scope", () => {
  for (const { agent, scope, segments, serves } of cases) {
    it(`${agent} at ${scope} scope writes to ${segments.join("/")} and reports ${serves.join(", ")}`, async () => {
      await withTempRoots(async ({ cwd, homeDir }) => {
        const report = await installSkill({ cwd, env: {}, homeDir }, "code-review", files, scope, agent);

        const base = scope === "project" ? cwd : homeDir;
        const expectedDir = join(base, ...segments, "code-review");
        expect(report).toEqual({ directory: expectedDir, agents: serves });
        expect(await readFile(join(expectedDir, "SKILL.md"), "utf8")).toContain("code-review");
        expect(await readFile(join(expectedDir, "scripts", "run.sh"), "utf8")).toBe("echo hi");
      });
    });
  }
});

describe("installSkill", () => {
  it("writes only where the chosen Agent reads, never into another Agent's directory", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      await installSkill({ cwd, env: {}, homeDir }, "code-review", files, "project", "claude-code");

      expect(await exists(join(cwd, ".claude", "skills", "code-review"))).toBe(true);
      expect(await exists(join(cwd, ".agents"))).toBe(false);
      expect(await exists(join(cwd, ".pi"))).toBe(false);
      expect(await exists(join(homeDir, ".claude"))).toBe(false);
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
      );

      expect(report.directory).toBe(join(custom, "skills", "code-review"));
      expect(await exists(join(homeDir, ".claude"))).toBe(false);
    });
  });

  it("sanitises the Skill's name before using it as a directory name", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const report = await installSkill({ cwd, env: {}, homeDir }, "../../Escape Me", files, "project", "generic");

      expect(report.directory).toBe(join(cwd, ".agents", "skills", "escape-me"));
      expect(await exists(join(cwd, "..", "..", "SKILL.md"))).toBe(false);
    });
  });

  it("re-running for the same Skill overwrites cleanly", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      await installSkill({ cwd, env: {}, homeDir }, "code-review", files, "project", "generic");

      const secondFiles = [{ path: "SKILL.md", bytes: encoder.encode("---\nname: code-review\ndescription: Updated.\n---\nNew body.\n") }];
      const report = await installSkill({ cwd, env: {}, homeDir }, "code-review", secondFiles, "project", "generic");

      expect(await readFile(join(report.directory, "SKILL.md"), "utf8")).toContain("Updated.");
      expect(await exists(join(report.directory, "scripts", "run.sh"))).toBe(false);
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
