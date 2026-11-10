import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { LOCKFILE_NAME } from "@in-org-quicko/skillset-installer";
import { writeConfig } from "../src/config.js";
import { runInfo } from "../src/commands/info.js";
import { runInstall, type InstallDeps } from "../src/commands/install.js";
import { runList } from "../src/commands/list.js";
import { runPublish, type PublishResult } from "../src/commands/publish.js";
import { runRemove } from "../src/commands/remove.js";
import { runSearch } from "../src/commands/search.js";
import { runUpdate } from "../src/commands/update.js";
import { jsonResponse, stubFetch } from "./helpers.js";

const encoder = new TextEncoder();
const REGISTRY = "https://registry.example";
const FIRST_PUBLISH = "2026-09-01T00:00:00.000Z";
const REPUBLISHED = "2026-09-20T00:00:00.000Z";

const source = (prompt: string) =>
  `---\nname: code-reviewer\ndescription: Reviews a diff.\ntools: [Read, Grep]\nmodel: sonnet\ncolor: blue\n---\n${prompt}`;

function fakeSubagent(updatedAt: string) {
  return {
    id: "subagent-1",
    kind: "subagent",
    name: "code-reviewer",
    description: "Reviews a diff.",
    body: "You review.\n",
    tools: "Read, Grep",
    model: "sonnet",
    published_by: { user_id: "u1", email: "writer@example.com", first_name: "A", last_name: "B" },
    published_at: FIRST_PUBLISH,
    updated_at: updatedAt,
    namespace: "registry.example",
    source: "com.example.registry",
    tags: [],
    installs: 0,
  };
}

/** A Registry holding one Subagent, whose `updated_at` and prompt the test moves to stand for a republish. */
function stubRegistry(state: { updatedAt: string; prompt: string }) {
  return stubFetch((url) => {
    if (url.split("?")[0] === `${REGISTRY}/api/resources/subagent/by-name/code-reviewer`) {
      return jsonResponse(200, fakeSubagent(state.updatedAt));
    }
    if (url.startsWith(`${REGISTRY}/api/resources/subagent-1/artifact`)) {
      return new Response(zipSync({ "code-reviewer.md": encoder.encode(source(state.prompt)) }), { status: 200 });
    }
    if (url.startsWith(`${REGISTRY}/api/resources?`)) {
      return jsonResponse(200, { items: [], page: 1, page_size: 10, total: 0 });
    }
    throw new Error(`Unexpected request to ${url}`);
  });
}

function deps(fetchImpl: typeof fetch, cwd: string, configPath: string): InstallDeps {
  return {
    fetch: fetchImpl,
    configPath,
    env: { SKILLSET_REGISTRY: REGISTRY },
    cwd,
    homeDir: cwd,
    isTTY: false,
    promptChoice: async () => {
      throw new Error("unexpected prompt");
    },
    promptAgent: async () => {
      throw new Error("unexpected agent prompt");
    },
  };
}

async function withTempDirs<T>(run: (dirs: { configPath: string; cwd: string }) => Promise<T>): Promise<T> {
  const configDir = await mkdtemp(join(tmpdir(), "skillset-sa-cfg-"));
  const cwd = await mkdtemp(join(tmpdir(), "skillset-sa-cwd-"));
  try {
    return await run({ configPath: join(configDir, "config.json"), cwd });
  } finally {
    await rm(configDir, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
}

const installed = (cwd: string) => join(cwd, ".claude", "agents", "code-reviewer.md");
const INSTALL = { name: "code-reviewer", kind: "subagent", scope: "project" };

describe("publishing a Subagent", () => {
  it("publishes a single markdown file as a Subagent, uploading it as <name>.md", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      await writeConfig(configPath, { registry: REGISTRY, token: "skr_test" });
      await writeFile(join(cwd, "reviewer-draft.md"), source("You review.\n"));

      const { fetch: fetchImpl, calls } = stubFetch((url, init) => {
        if (url === `${REGISTRY}/api/resources/subagent/code-reviewer`) {
          return jsonResponse(200, {
            resource: fakeSubagent(FIRST_PUBLISH),
            upload: {
              files: [{ path: "code-reviewer.md", url: "https://storage.example/x", method: "PUT", headers: {} }],
              expires_in_seconds: 60,
            },
          });
        }
        if (url === "https://storage.example/x" && init?.method === "PUT") return new Response(null, { status: 200 });
        throw new Error(`Unexpected request to ${url}`);
      });

      const result = (await runPublish(
        { fetch: fetchImpl, configPath, env: {}, cwd, isTTY: false, confirm: async () => false },
        { target: "reviewer-draft.md" },
      )) as PublishResult;

      expect(result).toMatchObject({ name: "code-reviewer", id: "subagent-1" });
      expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
        description: "Reviews a diff.",
        tools: "Read, Grep",
        model: "sonnet",
        files: [{ path: "code-reviewer.md" }],
      });
      expect(new TextDecoder().decode(calls[1]?.init?.body as Uint8Array)).toContain("color: blue");
    });
  });

  it("refuses a file that is not a valid Subagent before contacting the Registry", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      await writeFile(join(cwd, "notes.md"), "# Just notes\n");
      const { fetch: fetchImpl, calls } = stubFetch(() => {
        throw new Error("unexpected request");
      });
      await expect(
        runPublish({ fetch: fetchImpl, configPath, env: {}, cwd, isTTY: false, confirm: async () => false }, { target: "notes.md" }),
      ).rejects.toThrow(/frontmatter_missing/);
      expect(calls).toEqual([]);
    });
  });
});

describe("installing a Subagent (ADR-0047)", () => {
  it("writes the file as published into .claude/agents and records it in the lockfile", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, prompt: "You review.\n" });
      const report = await runInstall(deps(fetchImpl, cwd, configPath), INSTALL);

      expect(report.skillDirectory).toBe(installed(cwd));
      expect(report.agent).toBe("claude-code");
      expect(await readFile(installed(cwd), "utf8")).toBe(source("You review.\n"));
      expect((await readdir(cwd)).sort()).toEqual([".claude", LOCKFILE_NAME]);

      const lockfile = JSON.parse(await readFile(join(cwd, LOCKFILE_NAME), "utf8")) as {
        skills: object;
        subagents: Record<string, { id: string; registry_updated_at: string }>;
      };
      expect(lockfile.skills).toEqual({});
      expect(lockfile.subagents["code-reviewer"]).toMatchObject({ id: "subagent-1", registry_updated_at: FIRST_PUBLISH });
    });
  });

  it("refuses any Agent but Claude Code, and a URL", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, prompt: "You review.\n" });
      await expect(runInstall(deps(fetchImpl, cwd, configPath), { ...INSTALL, agent: "cursor" })).rejects.toThrow(/claude-code/);
      await expect(
        runInstall(deps(fetchImpl, cwd, configPath), { ...INSTALL, name: "https://github.com/acme/agents" }),
      ).rejects.toThrow(/URL/);
    });
  });

  it("refuses to replace a file it did not install, or one edited since, unless forced", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, prompt: "You review.\n" });
      await mkdir(join(cwd, ".claude", "agents"), { recursive: true });
      await writeFile(installed(cwd), "hand-written\n");

      await expect(runInstall(deps(fetchImpl, cwd, configPath), INSTALL)).rejects.toThrow(/not installed by skillset/);
      expect(await readFile(installed(cwd), "utf8")).toBe("hand-written\n");

      await runInstall(deps(fetchImpl, cwd, configPath), { ...INSTALL, force: true });
      await writeFile(installed(cwd), "edited\n");
      await expect(runInstall(deps(fetchImpl, cwd, configPath), INSTALL)).rejects.toThrow(/local changes/);
    });
  });
});

describe("a Subagent's lifecycle", () => {
  it("lists it, updates it once the Registry moves on, and removes it", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const state = { updatedAt: FIRST_PUBLISH, prompt: "You review.\n" };
      const { fetch: fetchImpl } = stubRegistry(state);
      const d = deps(fetchImpl, cwd, configPath);
      await runInstall(d, INSTALL);

      const statuses = async () => (await runList(d, {})).skills.map(({ kind, name, status }) => ({ kind, name, status }));
      expect(await statuses()).toEqual([{ kind: "subagent", name: "code-reviewer", status: "current" }]);

      state.updatedAt = REPUBLISHED;
      state.prompt = "You review carefully.\n";
      expect(await statuses()).toEqual([{ kind: "subagent", name: "code-reviewer", status: "outdated" }]);

      expect(await runUpdate(d, {})).toEqual([{ name: "code-reviewer", status: "updated", from: FIRST_PUBLISH, to: REPUBLISHED }]);
      expect(await readFile(installed(cwd), "utf8")).toContain("carefully");
      expect(await statuses()).toEqual([{ kind: "subagent", name: "code-reviewer", status: "current" }]);

      const removed = await runRemove(d, { name: "code-reviewer", kind: "subagent" });
      expect(removed).toMatchObject({ skillDirectory: installed(cwd), forgotten: true });
      expect(await readdir(join(cwd, ".claude", "agents"))).toEqual([]);
      expect((await readdir(cwd)).includes(LOCKFILE_NAME)).toBe(false);
    });
  });

  it("leaves a locally edited Subagent alone on update unless forced", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const state = { updatedAt: FIRST_PUBLISH, prompt: "You review.\n" };
      const { fetch: fetchImpl } = stubRegistry(state);
      const d = deps(fetchImpl, cwd, configPath);
      await runInstall(d, INSTALL);
      await writeFile(installed(cwd), "edited\n");
      state.updatedAt = REPUBLISHED;

      expect(await runUpdate(d, {})).toEqual([{ name: "code-reviewer", status: "skipped", reason: "modified" }]);
      expect(await runUpdate(d, { force: true })).toEqual([
        { name: "code-reviewer", status: "updated", from: FIRST_PUBLISH, to: REPUBLISHED },
      ]);
      expect(await readFile(installed(cwd), "utf8")).toBe(source("You review.\n"));
    });
  });
});

describe("reading the catalog by Kind", () => {
  it("searches and reads Subagents when --kind says so, and refuses an unknown Kind", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const { fetch: fetchImpl, calls } = stubRegistry({ updatedAt: FIRST_PUBLISH, prompt: "You review.\n" });
      const d = deps(fetchImpl, cwd, configPath);

      await runSearch(d, { kind: "subagent" });
      expect(calls[0]?.url).toContain("kind=subagent");

      const { skill } = await runInfo(d, { name: "code-reviewer", kind: "subagent" });
      expect(skill).toMatchObject({ kind: "subagent", tools: "Read, Grep", model: "sonnet" });

      await expect(runSearch(d, { kind: "plugin" })).rejects.toThrow(/Unknown kind "plugin"/);
    });
  });
});
