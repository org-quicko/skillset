import { describe, expect, it } from "bun:test";
import { detectAgent, nonUniversalProjectSkillsDirs } from "../src/index.js";

describe("detectAgent — override", () => {
  it("wins over every other signal", () => {
    const result = detectAgent({
      override: "windsurf",
      clientName: "Claude Code",
      env: { CLAUDECODE: "1" },
      agentDirsPresent: ["cursor"],
    });
    expect(result).toEqual({ agentId: "windsurf", step: "override" });
  });

  it("throws listing the valid ids when it names no Agent", () => {
    expect(() => detectAgent({ override: "not-an-agent" })).toThrow(/claude-code/);
  });
});

describe("detectAgent — client identity", () => {
  it("resolves by id, case-insensitively", () => {
    expect(detectAgent({ clientName: "CLAUDE-CODE" })).toEqual({ agentId: "claude-code", step: "client-identity" });
  });

  it("resolves by display name", () => {
    expect(detectAgent({ clientName: "Claude Code" })).toEqual({ agentId: "claude-code", step: "client-identity" });
  });

  it("falls through when the name matches no Agent", () => {
    expect(detectAgent({ clientName: "some-unknown-client" })).toEqual({ agentId: null, step: "canonical-fallback" });
  });
});

describe("detectAgent — environment markers", () => {
  it("resolves from an env marker when client identity does not", () => {
    expect(detectAgent({ clientName: "mystery", env: { CLAUDECODE: "1" } })).toEqual({
      agentId: "claude-code",
      step: "environment",
    });
  });

  it("ignores a blank marker value", () => {
    expect(detectAgent({ env: { CLAUDECODE: "   " } })).toEqual({ agentId: null, step: "canonical-fallback" });
  });
});

describe("detectAgent — project directories", () => {
  it("resolves when exactly one non-universal Agent directory is present", () => {
    expect(detectAgent({ agentDirsPresent: ["claude-code"] })).toEqual({
      agentId: "claude-code",
      step: "project-directory",
    });
  });

  it("does not resolve when two or more are present, and continues to the fallback", () => {
    expect(detectAgent({ agentDirsPresent: ["claude-code", "windsurf"] })).toEqual({
      agentId: null,
      step: "canonical-fallback",
    });
  });
});

describe("detectAgent — canonical fallback", () => {
  it("is the answer when no signal resolves", () => {
    expect(detectAgent({})).toEqual({ agentId: null, step: "canonical-fallback" });
  });
});

describe("nonUniversalProjectSkillsDirs", () => {
  const ctx = { env: {}, homeDir: "/home/dev", projectRoot: "/repo" };

  it("lists non-universal Agents with their project directory", () => {
    const entries = nonUniversalProjectSkillsDirs(ctx);
    expect(entries).toContainEqual({ agentId: "claude-code", dir: "/repo/.claude/skills" });
    expect(entries).toContainEqual({ agentId: "windsurf", dir: "/repo/.windsurf/skills" });
  });

  it("excludes the universal Agents that share .agents/skills", () => {
    const ids = nonUniversalProjectSkillsDirs(ctx).map((e) => e.agentId);
    expect(ids).not.toContain("codex");
    expect(ids).not.toContain("cursor");
  });
});
