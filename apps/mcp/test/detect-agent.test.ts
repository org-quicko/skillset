import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAgent } from "../src/detect-agent.js";
import type { McpConfig } from "../src/config.js";

const config = (agentId?: McpConfig["agentId"]): McpConfig => ({
  registry: "https://registry.example",
  scope: "project",
  agentId,
  logLevel: "warn",
  token: undefined,
});

async function withTempRoot<T>(run: (root: { cwd: string; homeDir: string }) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), "skillset-detect-cwd-"));
  const homeDir = await mkdtemp(join(tmpdir(), "skillset-detect-home-"));
  try {
    return await run({ cwd, homeDir });
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  }
}

describe("resolveAgent", () => {
  it("resolves from a single Agent directory present in the project", async () => {
    await withTempRoot(async ({ cwd, homeDir }) => {
      await mkdir(join(cwd, ".claude", "skills"), { recursive: true });

      const detection = resolveAgent(config(), undefined, { cwd, env: {}, homeDir });

      expect(detection).toEqual({ agentId: "claude-code", step: "project-directory" });
    });
  });

  it("resolves from an environment marker when no directory is present", async () => {
    await withTempRoot(async ({ cwd, homeDir }) => {
      const detection = resolveAgent(config(), undefined, { cwd, env: { CLAUDECODE: "1" }, homeDir });

      expect(detection).toEqual({ agentId: "claude-code", step: "environment" });
    });
  });

  it("falls back to canonical when nothing identifies an Agent", async () => {
    await withTempRoot(async ({ cwd, homeDir }) => {
      const detection = resolveAgent(config(), undefined, { cwd, env: {}, homeDir });

      expect(detection).toEqual({ agentId: null, step: "canonical-fallback" });
    });
  });

  it("honours the --agent override over the surroundings", async () => {
    await withTempRoot(async ({ cwd, homeDir }) => {
      await mkdir(join(cwd, ".claude", "skills"), { recursive: true });

      const detection = resolveAgent(config("windsurf"), "Claude Code", { cwd, env: { CLAUDECODE: "1" }, homeDir });

      expect(detection).toEqual({ agentId: "windsurf", step: "override" });
    });
  });
});
