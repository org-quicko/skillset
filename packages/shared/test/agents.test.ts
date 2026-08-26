import { describe, expect, it } from "bun:test";
import { AGENTS, canonicalInstallDir, resolveInstallDir, type AgentId, type Scope } from "../src/index.js";

const ctx = (env: Record<string, string | undefined> = {}) => ({ env, homeDir: "/home/dev", projectRoot: "/repo" });

describe("AGENTS table", () => {
  it("has exactly claude-code, codex, and generic", () => {
    expect(AGENTS.map((a) => a.id).sort()).toEqual(["claude-code", "codex", "generic"]);
  });
});

describe("resolveInstallDir — project scope", () => {
  it("codex and generic resolve to the same project directory", () => {
    expect(resolveInstallDir("codex", "project", ctx())).toBe(resolveInstallDir("generic", "project", ctx()));
    expect(resolveInstallDir("generic", "project", ctx())).toBe("/repo/.agents/skills");
  });

  it("claude-code never coincides with the canonical directory", () => {
    expect(resolveInstallDir("claude-code", "project", ctx())).toBe("/repo/.claude/skills");
    expect(resolveInstallDir("claude-code", "project", ctx())).not.toBe(canonicalInstallDir("project", ctx()));
  });
});

describe("resolveInstallDir — user scope", () => {
  const cases: Array<{ agent: AgentId; env: Record<string, string>; expected: string }> = [
    { agent: "claude-code", env: {}, expected: "/home/dev/.claude/skills" },
    { agent: "claude-code", env: { CLAUDE_CONFIG_DIR: "/custom/claude" }, expected: "/custom/claude/skills" },
    { agent: "codex", env: {}, expected: "/home/dev/.codex/skills" },
    { agent: "codex", env: { CODEX_HOME: "/custom/codex" }, expected: "/custom/codex/skills" },
    { agent: "generic", env: {}, expected: "/home/dev/.config/agents/skills" },
    { agent: "generic", env: { XDG_CONFIG_HOME: "/custom/config" }, expected: "/custom/config/agents/skills" },
  ];

  for (const { agent, env, expected } of cases) {
    it(`${agent} with env ${JSON.stringify(env)} -> ${expected}`, () => {
      expect(resolveInstallDir(agent, "user", ctx(env))).toBe(expected);
    });
  }

  it("at user scope, every Agent resolves to a distinct directory", () => {
    const dirs = AGENTS.map((agent) => resolveInstallDir(agent.id, "user", ctx()));
    expect(new Set(dirs).size).toBe(dirs.length);
  });

  it("an env override that is blank or whitespace-only falls back to the default", () => {
    expect(resolveInstallDir("claude-code", "user", ctx({ CLAUDE_CONFIG_DIR: "   " }))).toBe("/home/dev/.claude/skills");
  });
});

describe("canonicalInstallDir", () => {
  const scopes: Scope[] = ["project", "user"];
  for (const scope of scopes) {
    it(`equals resolveInstallDir("generic", "${scope}", ...)`, () => {
      expect(canonicalInstallDir(scope, ctx())).toBe(resolveInstallDir("generic", scope, ctx()));
    });
  }
});
