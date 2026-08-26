import { describe, expect, it } from "bun:test";
import { AGENTS, agentsSharingInstallDir, resolveInstallDir, type AgentId, type Scope } from "../src/index.js";

const ctx = (env: Record<string, string | undefined> = {}) => ({ env, homeDir: "/home/dev", projectRoot: "/repo" });

describe("AGENTS table", () => {
  it("has ADR-0006's five verified Agents plus generic", () => {
    expect(AGENTS.map((a) => a.id).sort()).toEqual(["claude-code", "codex", "generic", "github-copilot", "opencode", "pi"]);
  });
});

describe("resolveInstallDir — project scope", () => {
  it("codex, github-copilot, opencode, and generic — the project directory shared by three Agents (plus generic) — resolve identically", () => {
    const sharedAgents: AgentId[] = ["codex", "github-copilot", "opencode", "generic"];
    const dirs = sharedAgents.map((agent) => resolveInstallDir(agent, "project", ctx()));
    expect(new Set(dirs)).toEqual(new Set(["/repo/.agents/skills"]));
  });

  it("claude-code and pi have the project directory to themselves", () => {
    expect(resolveInstallDir("claude-code", "project", ctx())).toBe("/repo/.claude/skills");
    expect(resolveInstallDir("pi", "project", ctx())).toBe("/repo/.pi/skills");
  });
});

describe("resolveInstallDir — user scope", () => {
  const cases: Array<{ agent: AgentId; env: Record<string, string>; expected: string }> = [
    { agent: "claude-code", env: {}, expected: "/home/dev/.claude/skills" },
    { agent: "claude-code", env: { CLAUDE_CONFIG_DIR: "/custom/claude" }, expected: "/custom/claude/skills" },
    { agent: "codex", env: {}, expected: "/home/dev/.codex/skills" },
    { agent: "codex", env: { CODEX_HOME: "/custom/codex" }, expected: "/custom/codex/skills" },
    { agent: "github-copilot", env: {}, expected: "/home/dev/.copilot/skills" },
    // github-copilot has no environment override at all, per upstream — the default is unconditional.
    { agent: "github-copilot", env: { XDG_CONFIG_HOME: "/custom/config" }, expected: "/home/dev/.copilot/skills" },
    { agent: "opencode", env: {}, expected: "/home/dev/.config/opencode/skills" },
    { agent: "opencode", env: { XDG_CONFIG_HOME: "/custom/config" }, expected: "/custom/config/opencode/skills" },
    { agent: "pi", env: {}, expected: "/home/dev/.pi/agent/skills" },
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

describe("pi — the Agent whose two Scopes use different suffixes (ADR-0006)", () => {
  it("project Scope ends in /skills, user Scope ends in /agent/skills", () => {
    expect(resolveInstallDir("pi", "project", ctx())).toBe("/repo/.pi/skills");
    expect(resolveInstallDir("pi", "user", ctx())).toBe("/home/dev/.pi/agent/skills");
  });
});

describe("agentsSharingInstallDir", () => {
  it("names every Agent reading the project directory shared by three Agents plus generic", () => {
    const sharing: AgentId[] = ["codex", "github-copilot", "opencode", "generic"];
    for (const agent of sharing) {
      expect(agentsSharingInstallDir(agent, "project", ctx())).toEqual(sharing);
    }
  });

  it("names only the Agent itself when nothing else reads that directory", () => {
    expect(agentsSharingInstallDir("claude-code", "project", ctx())).toEqual(["claude-code"]);
    expect(agentsSharingInstallDir("pi", "project", ctx())).toEqual(["pi"]);
  });

  it("at user scope every Agent is alone, since no two resolve to the same directory", () => {
    const scopes: Scope[] = ["user"];
    for (const scope of scopes) {
      for (const agent of AGENTS) {
        expect(agentsSharingInstallDir(agent.id, scope, ctx())).toEqual([agent.id]);
      }
    }
  });

  it("follows an env override into a directory another Agent now shares", () => {
    // Pointing claude-code's config directory at opencode's makes one install serve both —
    // exactly the case the report exists to disclose.
    const shared = ctx({ CLAUDE_CONFIG_DIR: "/home/dev/.config/opencode" });
    expect(resolveInstallDir("claude-code", "user", shared)).toBe(resolveInstallDir("opencode", "user", shared));
    expect(agentsSharingInstallDir("opencode", "user", shared)).toEqual(["claude-code", "opencode"]);
  });
});
