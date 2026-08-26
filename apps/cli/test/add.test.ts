import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

describe("runAdd", () => {
  it("errors when not logged in, before any network call", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
    try {
      const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));
      await expect(
        runAdd(baseDeps({ fetch: fetchImpl, configPath: join(dir, "config.json") }), { name: "code-review" }),
      ).rejects.toThrow(/Not logged in/);
      expect(calls).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("errors immediately when scope/agent are missing and there's no terminal, before any network call", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
    try {
      const configPath = join(dir, "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "secret" });
      const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

      await expect(
        runAdd(baseDeps({ fetch: fetchImpl, configPath, isTTY: false }), { name: "code-review" }),
      ).rejects.toThrow(/Not a terminal/);
      expect(calls).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("installs with both --scope and --agent given, no prompting", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
    const cwd = await mkdtemp(join(tmpdir(), "skillreg-add-cwd-"));
    try {
      const configPath = join(dir, "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "secret" });

      const { fetch: fetchImpl } = stubFetch((url) => {
        if (url === "https://registry.example/api/skills/by-name/code-review") return jsonResponse(200, fakeSkill());
        if (url === "https://registry.example/api/skills/skill-1/artifact") {
          return new Response(validArtifactZip(), { status: 200 });
        }
        throw new Error(`Unexpected request to ${url}`);
      });

      const reports = await runAdd(
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
        { name: "code-review", scope: "project", agent: ["generic"] },
      );

      expect(reports).toEqual([{ directory: join(cwd, ".agents", "skills", "code-review"), mode: "canonical", agents: ["generic"] }]);
      expect(await readFile(join(cwd, ".agents", "skills", "code-review", "SKILL.md"), "utf8")).toContain("code-review");
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("prompts for scope and agent(s) when omitted and a terminal is attached", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
    const cwd = await mkdtemp(join(tmpdir(), "skillreg-add-cwd-"));
    try {
      const configPath = join(dir, "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "secret" });

      const { fetch: fetchImpl } = stubFetch((url) => {
        if (url === "https://registry.example/api/skills/by-name/code-review") return jsonResponse(200, fakeSkill());
        if (url === "https://registry.example/api/skills/skill-1/artifact") {
          return new Response(validArtifactZip(), { status: 200 });
        }
        throw new Error(`Unexpected request to ${url}`);
      });

      // Prompt order is Agent then Scope. First "1" picks AGENT_IDS[0] (claude-code); second "1" picks SCOPES[0] (project).
      const answers = ["1", "1"];
      const reports = await runAdd(
        baseDeps({
          fetch: fetchImpl,
          configPath,
          cwd,
          homeDir: cwd,
          isTTY: true,
          write: () => {},
          readLine: async () => answers.shift() ?? "",
        }),
        { name: "code-review" },
      );

      expect(reports).toEqual([{ directory: join(cwd, ".claude", "skills", "code-review"), mode: "symlink", agents: ["claude-code"] }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects an unknown --agent value before any network call", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
    try {
      const configPath = join(dir, "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "secret" });
      const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

      await expect(
        runAdd(baseDeps({ fetch: fetchImpl, configPath }), { name: "code-review", scope: "project", agent: ["not-a-real-agent"] }),
      ).rejects.toThrow(/Unknown Agent/);
      expect(calls).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a hostile Artifact and writes nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
    const cwd = await mkdtemp(join(tmpdir(), "skillreg-add-cwd-"));
    try {
      const configPath = join(dir, "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "secret" });

      const hostileZip = zipSync({
        "SKILL.md": encoder.encode("---\nname: code-review\ndescription: Reviews code.\n---\nBody.\n"),
        "../evil.txt": encoder.encode("escape"),
      });

      const { fetch: fetchImpl } = stubFetch((url) => {
        if (url === "https://registry.example/api/skills/by-name/code-review") return jsonResponse(200, fakeSkill());
        if (url === "https://registry.example/api/skills/skill-1/artifact") {
          return new Response(hostileZip, { status: 200 });
        }
        throw new Error(`Unexpected request to ${url}`);
      });

      await expect(
        runAdd(baseDeps({ fetch: fetchImpl, configPath, cwd, homeDir: cwd }), { name: "code-review", scope: "project", agent: ["generic"] }),
      ).rejects.toThrow(/entry_path_traversal/);

      await expect(readFile(join(cwd, ".agents", "skills", "code-review", "SKILL.md"), "utf8")).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
