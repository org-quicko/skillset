import { describe, expect, it } from "bun:test";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { runAdd, type AddDeps } from "../src/commands/add.js";
import { writeConfig } from "../src/config.js";
import { jsonResponse, stubFetch } from "./helpers.js";

const encoder = new TextEncoder();

function fakeSkill(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "skill-1",
    name: "code-review",
    description: "Reviews code.",
    body: "Body.\n",
    published_by: { user_id: "u1", email: "writer@example.com", first_name: "A", last_name: "B" },
    published_at: new Date().toISOString(),
    license: null,
    compatibility: null,
    metadata: null,
    allowed_tools: null,
    tags: [],
    installs: 3,
    ...overrides,
  };
}

function validArtifactZip(): Uint8Array {
  return zipSync({ "SKILL.md": encoder.encode("---\nname: code-review\ndescription: Reviews code.\n---\nBody.\n") });
}

/** Answers the two requests `add` makes: the Skill's metadata, then its Artifact. */
function stubRegistry(artifact: Uint8Array = validArtifactZip()) {
  return stubFetch((url) => {
    if (url === "https://registry.example/api/skills/by-name/code-review") return jsonResponse(200, fakeSkill());
    if (url === "https://registry.example/api/skills/skill-1/artifact") return new Response(artifact, { status: 200 });
    throw new Error(`Unexpected request to ${url}`);
  });
}

function baseDeps(overrides: Partial<AddDeps> & { fetch: typeof fetch; configPath: string }): AddDeps {
  return {
    env: {},
    cwd: "/unused",
    homeDir: "/unused",
    isTTY: false,
    write: () => {},
    readLine: async () => "",
    ...overrides,
  };
}

async function withTempDirs<T>(run: (dirs: { configDir: string; cwd: string }) => Promise<T>): Promise<T> {
  const configDir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
  const cwd = await mkdtemp(join(tmpdir(), "skillreg-add-cwd-"));
  try {
    return await run({ configDir, cwd });
  } finally {
    await rm(configDir, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
}

describe("runAdd", () => {
  it("errors when no Registry is configured, before any network call", async () => {
    await withTempDirs(async ({ configDir }) => {
      const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));
      await expect(
        runAdd(baseDeps({ fetch: fetchImpl, configPath: join(configDir, "config.json") }), { name: "code-review" }),
      ).rejects.toThrow(/No Registry configured/);
      expect(calls).toHaveLength(0);
    });
  });

  it("installs with no Token at all — reads need none (ADR-0013)", async () => {
    await withTempDirs(async ({ configDir, cwd }) => {
      const { fetch: fetchImpl, calls } = stubRegistry();

      const report = await runAdd(
        baseDeps({
          fetch: fetchImpl,
          configPath: join(configDir, "config.json"),
          env: { SKILLREG_REGISTRY: "https://registry.example" },
          cwd,
          homeDir: cwd,
        }),
        { name: "code-review", scope: "project", agent: "generic" },
      );

      expect(report.directory).toBe(join(cwd, ".agents", "skills", "code-review"));
      for (const call of calls) {
        expect(call.init?.headers).not.toHaveProperty("authorization");
      }
    });
  });

  it("errors immediately when scope/agent are missing and there's no terminal, before any network call", async () => {
    await withTempDirs(async ({ configDir }) => {
      const configPath = join(configDir, "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "secret" });
      const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

      await expect(
        runAdd(baseDeps({ fetch: fetchImpl, configPath, isTTY: false }), { name: "code-review" }),
      ).rejects.toThrow(/Not a terminal/);
      expect(calls).toHaveLength(0);
    });
  });

  it("installs with both --scope and --agent given, no prompting", async () => {
    await withTempDirs(async ({ configDir, cwd }) => {
      const configPath = join(configDir, "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "secret" });
      const { fetch: fetchImpl } = stubRegistry();

      const report = await runAdd(
        baseDeps({
          fetch: fetchImpl,
          configPath,
          cwd,
          homeDir: cwd,
          isTTY: false,
          readLine: async () => {
            throw new Error("should not prompt");
          },
        }),
        { name: "code-review", scope: "project", agent: "codex" },
      );

      expect(report).toEqual({
        directory: join(cwd, ".agents", "skills", "code-review"),
        agents: ["codex", "github-copilot", "opencode", "generic"],
      });
      expect(await readFile(join(cwd, ".agents", "skills", "code-review", "SKILL.md"), "utf8")).toContain("code-review");
    });
  });

  it("prompts for the Agent, then the Scope, when both are omitted and a terminal is attached", async () => {
    await withTempDirs(async ({ configDir, cwd }) => {
      const configPath = join(configDir, "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "secret" });
      const { fetch: fetchImpl } = stubRegistry();

      const questions: string[] = [];
      // First "1" picks AGENT_IDS[0] (claude-code); second "1" picks SCOPES[0] (project).
      const answers = ["1", "1"];
      const report = await runAdd(
        baseDeps({
          fetch: fetchImpl,
          configPath,
          cwd,
          homeDir: cwd,
          isTTY: true,
          write: (text) => {
            if (text.startsWith("Install for which")) questions.push(text.trim());
          },
          readLine: async () => answers.shift() ?? "",
        }),
        { name: "code-review" },
      );

      expect(questions).toEqual(["Install for which Agent?", "Install for which scope?"]);
      expect(report).toEqual({ directory: join(cwd, ".claude", "skills", "code-review"), agents: ["claude-code"] });
    });
  });

  it("rejects an unknown --agent value before any network call", async () => {
    await withTempDirs(async ({ configDir }) => {
      const configPath = join(configDir, "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "secret" });
      const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

      await expect(
        runAdd(baseDeps({ fetch: fetchImpl, configPath }), { name: "code-review", scope: "project", agent: "not-a-real-agent" }),
      ).rejects.toThrow(/Unknown Agent/);
      expect(calls).toHaveLength(0);
    });
  });

  it("rejects a hostile Artifact and writes nothing", async () => {
    await withTempDirs(async ({ configDir, cwd }) => {
      const configPath = join(configDir, "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "secret" });

      const hostileZip = zipSync({
        "SKILL.md": encoder.encode("---\nname: code-review\ndescription: Reviews code.\n---\nBody.\n"),
        "../evil.txt": encoder.encode("escape"),
      });
      const { fetch: fetchImpl } = stubRegistry(hostileZip);

      await expect(
        runAdd(baseDeps({ fetch: fetchImpl, configPath, cwd, homeDir: cwd }), {
          name: "code-review",
          scope: "project",
          agent: "generic",
        }),
      ).rejects.toThrow(/entry_path_traversal/);

      await expect(access(join(cwd, ".agents"))).rejects.toThrow();
    });
  });
});
