import { describe, expect, it } from "bun:test";
import {
  agentSkillsDir,
  AGENTS,
  canonicalSkillsDir,
  CANONICAL_SKILLS_DIR,
  getAgent,
  isUniversalAgent,
  type AgentId,
} from "../src/index.js";

const ctx = (env: Record<string, string | undefined> = {}) => ({ env, homeDir: "/home/dev", projectRoot: "/repo" });

describe("AGENTS table", () => {
  it("carries the full vendored Agent list, with no duplicate ids", () => {
    const ids = AGENTS.map((a) => a.id);
    expect(ids.length).toBeGreaterThan(70);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("no longer includes the withdrawn generic Agent (ADR-0022)", () => {
    expect(AGENTS.map((a) => a.id as string)).not.toContain("generic");
  });

  it("names claude-code and pi, the two the User asked about", () => {
    expect(AGENTS.some((a) => a.id === "claude-code")).toBe(true);
    expect(AGENTS.some((a) => a.id === "pi")).toBe(true);
  });
});

describe("isUniversalAgent", () => {
  it("is true for Agents that read .agents/skills directly", () => {
    expect(isUniversalAgent("codex")).toBe(true);
    expect(isUniversalAgent("cursor")).toBe(true);
    expect(isUniversalAgent("github-copilot")).toBe(true);
  });

  it("is false for Agents with their own directory", () => {
    expect(isUniversalAgent("claude-code")).toBe(false);
    expect(isUniversalAgent("pi")).toBe(false);
  });

  it("every universal Agent's project directory is exactly the canonical one", () => {
    for (const agent of AGENTS) {
      if (isUniversalAgent(agent.id)) expect(agent.projectSkillsDir).toBe(CANONICAL_SKILLS_DIR);
    }
  });
});

describe("canonicalSkillsDir", () => {
  it("is <projectRoot>/.agents/skills at project scope", () => {
    expect(canonicalSkillsDir("project", ctx())).toBe("/repo/.agents/skills");
  });

  it("is <homeDir>/.agents/skills at user scope", () => {
    expect(canonicalSkillsDir("user", ctx())).toBe("/home/dev/.agents/skills");
  });
});

describe("agentSkillsDir — project scope", () => {
  it("resolves a non-universal Agent to its own directory", () => {
    expect(agentSkillsDir("claude-code", "project", ctx())).toBe("/repo/.claude/skills");
    expect(agentSkillsDir("pi", "project", ctx())).toBe("/repo/.pi/skills");
  });

  it("resolves a universal Agent to the canonical directory", () => {
    expect(agentSkillsDir("codex", "project", ctx())).toBe(canonicalSkillsDir("project", ctx()));
  });
});

describe("agentSkillsDir — user scope", () => {
  const cases: Array<{ agent: AgentId; env: Record<string, string>; expected: string }> = [
    { agent: "claude-code", env: {}, expected: "/home/dev/.claude/skills" },
    { agent: "claude-code", env: { CLAUDE_CONFIG_DIR: "/custom/claude" }, expected: "/custom/claude/skills" },
    { agent: "codex", env: {}, expected: "/home/dev/.codex/skills" },
    { agent: "codex", env: { CODEX_HOME: "/custom/codex" }, expected: "/custom/codex/skills" },
    { agent: "github-copilot", env: {}, expected: "/home/dev/.copilot/skills" },
    { agent: "github-copilot", env: { XDG_CONFIG_HOME: "/custom/config" }, expected: "/home/dev/.copilot/skills" },
    { agent: "opencode", env: {}, expected: "/home/dev/.config/opencode/skills" },
    { agent: "opencode", env: { XDG_CONFIG_HOME: "/custom/config" }, expected: "/custom/config/opencode/skills" },
    { agent: "pi", env: {}, expected: "/home/dev/.pi/agent/skills" },
    { agent: "grok", env: { GROK_HOME: "/custom/grok" }, expected: "/custom/grok/skills" },
  ];

  for (const { agent, env, expected } of cases) {
    it(`${agent} with env ${JSON.stringify(env)} -> ${expected}`, () => {
      expect(agentSkillsDir(agent, "user", ctx(env))).toBe(expected);
    });
  }

  it("returns null for an Agent with no user-level directory", () => {
    expect(agentSkillsDir("eve", "user", ctx())).toBeNull();
    expect(agentSkillsDir("promptscript", "user", ctx())).toBeNull();
  });

  it("an env override that is blank or whitespace-only falls back to the default", () => {
    expect(agentSkillsDir("claude-code", "user", ctx({ CLAUDE_CONFIG_DIR: "   " }))).toBe("/home/dev/.claude/skills");
  });
});

describe("pi — the Agent whose two Scopes use different suffixes", () => {
  it("project Scope ends in /skills, user Scope ends in /agent/skills", () => {
    expect(agentSkillsDir("pi", "project", ctx())).toBe("/repo/.pi/skills");
    expect(agentSkillsDir("pi", "user", ctx())).toBe("/home/dev/.pi/agent/skills");
  });
});

describe("getAgent", () => {
  it("throws on an unknown id", () => {
    expect(() => getAgent("nope" as AgentId)).toThrow(/Unknown Agent/);
  });
});
