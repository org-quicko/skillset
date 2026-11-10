import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  forgetInstall,
  hashSkillFiles,
  installSubagent,
  LOCKFILE_NAME,
  readInstalled,
  recordInstall,
  removeSubagent,
  resolveSubagentTarget,
  type InstallContext,
  type LockfileEntry,
} from "../src/index.js";

const REGISTRY = "https://registry.example";
const bytes = new TextEncoder().encode("---\nname: reviewer\ndescription: Reviews.\n---\nYou review.\n");

async function withContext<T>(run: (ctx: InstallContext) => Promise<T>, env: InstallContext["env"] = {}): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), "skillset-subagent-cwd-"));
  const homeDir = await mkdtemp(join(tmpdir(), "skillset-subagent-home-"));
  try {
    return await run({ cwd, env, homeDir });
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  }
}

const entry = (overrides: Partial<LockfileEntry> = {}): LockfileEntry => ({
  id: "01a0c2b9-5ae9-782d-8ae6-d27d8d18a968",
  registry_updated_at: "2026-09-21T06:48:42.469Z",
  content_hash: hashSkillFiles([{ path: "reviewer.md", bytes }]),
  installed_at: "2026-09-21T07:00:00.000Z",
  ...overrides,
});

describe("installSubagent (ADR-0047)", () => {
  it("writes <name>.md into .claude/agents at project Scope, and nothing beside it", async () => {
    await withContext(async (ctx) => {
      const path = await installSubagent(ctx, "reviewer", bytes, "project");

      expect(path).toBe(join(ctx.cwd, ".claude", "agents", "reviewer.md"));
      expect(await readFile(path, "utf8")).toContain("You review.");
      expect(await readdir(join(ctx.cwd, ".claude", "agents"))).toEqual(["reviewer.md"]);
      expect(await readdir(ctx.cwd)).toEqual([".claude"]);
    });
  });

  it("writes under ~/.claude/agents at user Scope, or CLAUDE_CONFIG_DIR when set", async () => {
    await withContext(async (ctx) => {
      expect(await installSubagent(ctx, "reviewer", bytes, "user")).toBe(join(ctx.homeDir, ".claude", "agents", "reviewer.md"));
    });
    await withContext(
      async (ctx) => {
        expect(resolveSubagentTarget(ctx, "reviewer", "user")).toBe("/custom/claude/agents/reviewer.md");
      },
      { CLAUDE_CONFIG_DIR: "/custom/claude" },
    );
  });

  it("removes the file, and reports nothing removed when it was not there", async () => {
    await withContext(async (ctx) => {
      const path = await installSubagent(ctx, "reviewer", bytes, "project");
      expect(await removeSubagent(ctx, "reviewer", "project")).toBe(path);
      expect(await removeSubagent(ctx, "reviewer", "project")).toBeNull();
    });
  });
});

describe("the lockfile's Subagents", () => {
  it("records a Subagent beside a Skill of the same name without either replacing the other", async () => {
    await withContext(async (ctx) => {
      await recordInstall(ctx, "project", REGISTRY, "reviewer", entry({ content_hash: "sha256:skill" }));
      await recordInstall(ctx, "project", REGISTRY, "reviewer", entry(), "subagent");

      const stored = JSON.parse(await readFile(join(ctx.cwd, LOCKFILE_NAME), "utf8")) as Record<string, Record<string, LockfileEntry>>;
      expect(stored.skills?.reviewer?.content_hash).toBe("sha256:skill");
      expect(stored.subagents?.reviewer?.content_hash).toBe(entry().content_hash);
    });
  });

  it("reads an installed Subagent as current, modified once edited, and missing once deleted", async () => {
    await withContext(async (ctx) => {
      const path = await installSubagent(ctx, "reviewer", bytes, "project");
      await recordInstall(ctx, "project", REGISTRY, "reviewer", entry(), "subagent");

      const statusNow = async () => (await readInstalled(ctx, "project", null)).map(({ kind, name, status }) => ({ kind, name, status }));
      expect(await statusNow()).toEqual([{ kind: "subagent", name: "reviewer", status: "current" }]);

      await writeFile(path, "edited");
      expect((await statusNow())[0]?.status).toBe("modified");

      await rm(path);
      expect((await statusNow())[0]?.status).toBe("missing");
    });
  });

  it("asks the Registry about a Subagent as a Subagent, and reads outdated when it has moved on", async () => {
    await withContext(async (ctx) => {
      await installSubagent(ctx, "reviewer", bytes, "project");
      await recordInstall(ctx, "project", REGISTRY, "reviewer", entry(), "subagent");

      const asked: string[] = [];
      const [installed] = await readInstalled(ctx, "project", async (name, _namespace, kind) => {
        asked.push(`${kind}/${name}`);
        return "2026-10-01T00:00:00.000Z";
      });
      expect(asked).toEqual(["subagent/reviewer"]);
      expect(installed?.status).toBe("outdated");
    });
  });

  it("removes the lockfile once its last Subagent is forgotten", async () => {
    await withContext(async (ctx) => {
      await recordInstall(ctx, "project", REGISTRY, "reviewer", entry(), "subagent");
      expect(await forgetInstall(ctx, "project", "reviewer")).toBe(false);
      expect(await forgetInstall(ctx, "project", "reviewer", "subagent")).toBe(true);
      expect(await readdir(ctx.cwd)).toEqual([]);
    });
  });
});
