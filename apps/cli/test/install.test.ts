import { describe, expect, it } from "bun:test";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { runInstall, type InstallDeps } from "../src/commands/install.js";
import { writeConfig } from "../src/config.js";
import { jsonResponse, stubFetch } from "./helpers.js";

const encoder = new TextEncoder();

function fakeSkill(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "skill-1",
    kind: "skill",
    name: "code-review",
    description: "Reviews code.",
    body: "Body.\n",
    published_by: { user_id: "u1", email: "writer@example.com", first_name: "A", last_name: "B" },
    published_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    license: null,
    compatibility: null,
    metadata: null,
    allowed_tools: null,
    namespace: "registry.example",
    source: "com.example.registry",
    tags: [],
    installs: 3,
    ...overrides,
  };
}

function validArtifactZip(): Uint8Array {
  return zipSync({ "SKILL.md": encoder.encode("---\nname: code-review\ndescription: Reviews code.\n---\nBody.\n") });
}

/** Answers the two requests `install` makes: the Skill's metadata, then its Artifact. */
function stubRegistry(artifact: Uint8Array = validArtifactZip()) {
  return stubFetch((url) => {
    if (url === "https://registry.example/api/resources/skill/by-name/code-review") return jsonResponse(200, fakeSkill());
    if (url === "https://registry.example/api/resources/skill-1/artifact?source=cli") return new Response(artifact, { status: 200 });
    throw new Error(`Unexpected request to ${url}`);
  });
}

function baseDeps(overrides: Partial<InstallDeps> & { fetch: typeof fetch; configPath: string }): InstallDeps {
  return {
    env: {},
    cwd: "/unused",
    homeDir: "/unused",
    isTTY: false,
    promptChoice: async () => {
      throw new Error("unexpected prompt");
    },
    promptAgent: async () => {
      throw new Error("unexpected agent prompt");
    },
    ...overrides,
  };
}

async function withTempDirs<T>(run: (dirs: { configDir: string; cwd: string }) => Promise<T>): Promise<T> {
  const configDir = await mkdtemp(join(tmpdir(), "skillset-test-"));
  const cwd = await mkdtemp(join(tmpdir(), "skillset-add-cwd-"));
  try {
    return await run({ configDir, cwd });
  } finally {
    await rm(configDir, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
}

describe("runInstall", () => {
  it("errors when no Registry is configured, before any network call", async () => {
    await withTempDirs(async ({ configDir }) => {
      const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));
      await expect(
        runInstall(baseDeps({ fetch: fetchImpl, configPath: join(configDir, "config.json") }), { name: "code-review" }),
      ).rejects.toThrow(/No Registry configured/);
      expect(calls).toHaveLength(0);
    });
  });

  it("installs with no Token at all — reads need none (ADR-0013)", async () => {
    await withTempDirs(async ({ configDir, cwd }) => {
      const { fetch: fetchImpl, calls } = stubRegistry();

      const report = await runInstall(
        baseDeps({
          fetch: fetchImpl,
          configPath: join(configDir, "config.json"),
          env: { SKILLSET_REGISTRY: "https://registry.example" },
          cwd,
          homeDir: cwd,
        }),
        { name: "code-review", scope: "project", agent: "codex" },
      );

      expect(report.skillDirectory).toBe(join(cwd, ".agents", "skills", "code-review"));
      for (const call of calls) {
        expect(call.init?.headers).not.toHaveProperty("authorization");
      }
    });
  });

  it("downloads the Artifact with `?source=cli`, tagging the Install as the CLI's (ticket 48)", async () => {
    await withTempDirs(async ({ configDir, cwd }) => {
      const { fetch: fetchImpl, calls } = stubRegistry();

      await runInstall(
        baseDeps({
          fetch: fetchImpl,
          configPath: join(configDir, "config.json"),
          env: { SKILLSET_REGISTRY: "https://registry.example" },
          cwd,
          homeDir: cwd,
        }),
        { name: "code-review", scope: "project", agent: "codex" },
      );

      const artifactCall = calls.find((call) => call.url.includes("/resources/skill-1/artifact"));
      expect(artifactCall?.url).toBe("https://registry.example/api/resources/skill-1/artifact?source=cli");
    });
  });

  it("errors immediately when --scope is missing and there's no terminal, before any network call", async () => {
    await withTempDirs(async ({ configDir }) => {
      const configPath = join(configDir, "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "secret" });
      const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

      await expect(
        runInstall(baseDeps({ fetch: fetchImpl, configPath, isTTY: false }), { name: "code-review" }),
      ).rejects.toThrow(/Not a terminal/);
      expect(calls).toHaveLength(0);
    });
  });

  it("detects the Agent when --agent is omitted and there's no terminal", async () => {
    await withTempDirs(async ({ configDir, cwd }) => {
      const configPath = join(configDir, "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "secret" });
      const { fetch: fetchImpl } = stubRegistry();

      const report = await runInstall(
        baseDeps({
          fetch: fetchImpl,
          configPath,
          cwd,
          homeDir: cwd,
          isTTY: false,
          env: { CLAUDECODE: "1" },
        }),
        { name: "code-review", scope: "project" },
      );

      expect(report.agent).toBe("claude-code");
      expect(report.link).toEqual({ kind: "symlink", path: join(cwd, ".claude", "skills", "code-review") });
    });
  });

  it("installs canonically with no link when nothing identifies an Agent (no terminal, no --agent)", async () => {
    await withTempDirs(async ({ configDir, cwd }) => {
      const configPath = join(configDir, "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "secret" });
      const { fetch: fetchImpl } = stubRegistry();

      const report = await runInstall(
        baseDeps({ fetch: fetchImpl, configPath, cwd, homeDir: cwd, isTTY: false }),
        { name: "code-review", scope: "project" },
      );

      expect(report.agent).toBeNull();
      expect(report.link).toEqual({ kind: "canonical" });
      expect(await readFile(join(cwd, ".agents", "skills", "code-review", "SKILL.md"), "utf8")).toContain("code-review");
    });
  });

  it("installs with both --scope and --agent given, no prompting", async () => {
    await withTempDirs(async ({ configDir, cwd }) => {
      const configPath = join(configDir, "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "secret" });
      const { fetch: fetchImpl } = stubRegistry();

      const report = await runInstall(
        baseDeps({ fetch: fetchImpl, configPath, cwd, homeDir: cwd, isTTY: false }),
        { name: "code-review", scope: "project", agent: "codex" },
      );

      // Not a full toEqual: `codex` is one of many Agents reading .agents/skills
      // directly, so `alsoServes` names the rest — covered on its own in install.test.ts.
      expect(report.skillDirectory).toBe(join(cwd, ".agents", "skills", "code-review"));
      expect(report.agent).toBe("codex");
      expect(report.link).toEqual({ kind: "canonical" });
      expect(await readFile(join(cwd, ".agents", "skills", "code-review", "SKILL.md"), "utf8")).toContain("code-review");
    });
  });

  it("--copy writes into the Agent's own directory instead of symlinking", async () => {
    await withTempDirs(async ({ configDir, cwd }) => {
      const configPath = join(configDir, "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "secret" });
      const { fetch: fetchImpl } = stubRegistry();

      const report = await runInstall(
        baseDeps({ fetch: fetchImpl, configPath, cwd, homeDir: cwd, isTTY: false }),
        { name: "code-review", scope: "project", agent: "claude-code", copy: true },
      );

      expect(report.link).toEqual({
        kind: "copy",
        path: join(cwd, ".claude", "skills", "code-review"),
        reason: "requested",
      });
    });
  });

  it("prompts for the Agent (searchably), then the Scope, when both are omitted and a terminal is attached", async () => {
    await withTempDirs(async ({ configDir, cwd }) => {
      const configPath = join(configDir, "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "secret" });
      const { fetch: fetchImpl } = stubRegistry();

      const seen: string[] = [];
      const report = await runInstall(
        baseDeps({
          fetch: fetchImpl,
          configPath,
          cwd,
          homeDir: cwd,
          isTTY: true,
          promptAgent: async (choices) => {
            seen.push("agent");
            expect(choices.some((c) => c.id === "claude-code")).toBe(true);
            return "claude-code";
          },
          promptChoice: async (question, choices) => {
            seen.push(question);
            return choices[0]!;
          },
        }),
        { name: "code-review" },
      );

      expect(seen).toEqual(["agent", "Install for which scope?"]);
      expect(report.skillDirectory).toBe(join(cwd, ".agents", "skills", "code-review"));
      expect(report.link).toEqual({ kind: "symlink", path: join(cwd, ".claude", "skills", "code-review") });
    });
  });

  it("rejects an unknown --agent value before any network call", async () => {
    await withTempDirs(async ({ configDir }) => {
      const configPath = join(configDir, "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "secret" });
      const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

      await expect(
        runInstall(baseDeps({ fetch: fetchImpl, configPath }), { name: "code-review", scope: "project", agent: "not-a-real-agent" }),
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
        runInstall(baseDeps({ fetch: fetchImpl, configPath, cwd, homeDir: cwd }), {
          name: "code-review",
          scope: "project",
          agent: "codex",
        }),
      ).rejects.toThrow(/entry_path_traversal/);

      await expect(access(join(cwd, ".agents"))).rejects.toThrow();
    });
  });
});

// A project holds one `.agents/skills/<name>` however many parties publish that
// name (ADR-0022, ADR-0042), so the CLI has to resolve the tie the Registry
// cannot.
describe("runInstall and Namespaces (ADR-0042)", () => {
  const IMPORTED = "anthropics/skills";

  /** Answers both the bare and the qualified lookup, each with its own Namespace. */
  function stubBoth() {
    return stubFetch((url) => {
      if (url === "https://registry.example/api/resources/skill/by-name/code-review") {
        return jsonResponse(200, fakeSkill());
      }
      if (url === "https://registry.example/api/resources/skill/by-name/code-review?namespace=anthropics%2Fskills") {
        return jsonResponse(200, fakeSkill({ id: "skill-2", namespace: IMPORTED, source: "https://github.com/anthropics/skills" }));
      }
      if (url.startsWith("https://registry.example/api/resources/skill-")) {
        return new Response(validArtifactZip(), { status: 200 });
      }
      throw new Error(`Unexpected request to ${url}`);
    });
  }

  function depsFor(configDir: string, cwd: string, fetchImpl: typeof fetch): InstallDeps {
    return baseDeps({
      fetch: fetchImpl,
      configPath: join(configDir, "config.json"),
      env: { SKILLSET_REGISTRY: "https://registry.example" },
      cwd,
      homeDir: cwd,
    });
  }

  async function lockedNamespace(cwd: string): Promise<string | undefined> {
    const lockfile = JSON.parse(await readFile(join(cwd, "skillset-lock.json"), "utf8")) as {
      skills: Record<string, { namespace?: string }>;
    };
    return lockfile.skills["code-review"]?.namespace;
  }

  it("sends the Namespace as a query parameter, never as more path segments", async () => {
    await withTempDirs(async ({ configDir, cwd }) => {
      const { fetch: fetchImpl, calls } = stubBoth();

      await runInstall(depsFor(configDir, cwd, fetchImpl), {
        name: "code-review",
        namespace: IMPORTED,
        scope: "project",
        agent: "codex",
      });

      expect(calls[0]?.url).toBe(
        "https://registry.example/api/resources/skill/by-name/code-review?namespace=anthropics%2Fskills",
      );
    });
  });

  it("records which party named the Skill it installed", async () => {
    await withTempDirs(async ({ configDir, cwd }) => {
      const { fetch: fetchImpl } = stubBoth();

      await runInstall(depsFor(configDir, cwd, fetchImpl), {
        name: "code-review",
        namespace: IMPORTED,
        scope: "project",
        agent: "codex",
      });

      expect(await lockedNamespace(cwd)).toBe(IMPORTED);
    });
  });

  it("refuses to install over a Skill of the same name that a different party named", async () => {
    await withTempDirs(async ({ configDir, cwd }) => {
      const { fetch: fetchImpl } = stubBoth();
      const deps = depsFor(configDir, cwd, fetchImpl);

      await runInstall(deps, { name: "code-review", scope: "project", agent: "codex" });
      await expect(
        runInstall(deps, { name: "code-review", namespace: IMPORTED, scope: "project", agent: "codex" }),
      ).rejects.toThrow(/already installed from registry.example/);

      // Refused before anything was written: the first install still stands.
      expect(await lockedNamespace(cwd)).toBe("registry.example");
    });
  });

  it("replaces it when --force says to", async () => {
    await withTempDirs(async ({ configDir, cwd }) => {
      const { fetch: fetchImpl } = stubBoth();
      const deps = depsFor(configDir, cwd, fetchImpl);

      await runInstall(deps, { name: "code-review", scope: "project", agent: "codex" });
      await runInstall(deps, { name: "code-review", namespace: IMPORTED, scope: "project", agent: "codex", force: true });

      expect(await lockedNamespace(cwd)).toBe(IMPORTED);
    });
  });

  it("leaves an entry written before Namespaces existed alone, rather than refusing on unknown", async () => {
    await withTempDirs(async ({ configDir, cwd }) => {
      const { fetch: fetchImpl } = stubBoth();
      const deps = depsFor(configDir, cwd, fetchImpl);

      await runInstall(deps, { name: "code-review", scope: "project", agent: "codex" });

      // An older CLI's lockfile: an entry with no Namespace at all.
      const path = join(cwd, "skillset-lock.json");
      const lockfile = JSON.parse(await readFile(path, "utf8")) as { skills: Record<string, Record<string, unknown>> };
      delete lockfile.skills["code-review"]?.namespace;
      await writeFile(path, JSON.stringify(lockfile));

      await runInstall(deps, { name: "code-review", namespace: IMPORTED, scope: "project", agent: "codex" });
      expect(await lockedNamespace(cwd)).toBe(IMPORTED);
    });
  });
});
