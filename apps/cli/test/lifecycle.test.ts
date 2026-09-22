import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { LOCKFILE_NAME } from "@in-org-quicko/skillset-installer";
import { runInstall, type InstallDeps } from "../src/commands/install.js";
import { runList } from "../src/commands/list.js";
import { runRemove } from "../src/commands/remove.js";
import { runUpdate } from "../src/commands/update.js";
import type { InstalledDeps } from "../src/commands/installed.js";
import { jsonResponse, stubFetch } from "./helpers.js";

const encoder = new TextEncoder();
const REGISTRY = "https://registry.example";
const FIRST_PUBLISH = "2026-09-01T00:00:00.000Z";
const REPUBLISHED = "2026-09-20T00:00:00.000Z";

function fakeSkill(updatedAt: string) {
  return {
    id: "skill-1",
    kind: "skill",
    name: "code-review",
    description: "Reviews code.",
    body: "Body.\n",
    published_by: { user_id: "u1", email: "writer@example.com", first_name: "A", last_name: "B" },
    published_at: FIRST_PUBLISH,
    updated_at: updatedAt,
    license: null,
    compatibility: null,
    metadata: null,
    allowed_tools: null,
    namespace: "registry.example",
    source: "com.example.registry",
    tags: [],
    installs: 0,
  };
}

function artifact(body: string): Uint8Array {
  return zipSync({
    "SKILL.md": encoder.encode(`---\nname: code-review\ndescription: Reviews code.\n---\n${body}`),
  });
}

/**
 * A Registry holding one Skill, whose `updated_at` and Artifact contents the
 * test moves to stand for a republish.
 */
function stubRegistry(state: { updatedAt: string; body: string }) {
  return stubFetch((url) => {
    if (url === `${REGISTRY}/api/resources/skill/by-name/code-review`) {
      return jsonResponse(200, fakeSkill(state.updatedAt));
    }
    if (url.startsWith(`${REGISTRY}/api/resources/skill-1/artifact`)) {
      return new Response(artifact(state.body), { status: 200 });
    }
    if (url.startsWith(`${REGISTRY}/api/resources/skill/by-name/`)) {
      return jsonResponse(404, { error: { code: "not_found", message: "No Resource by that id." } });
    }
    throw new Error(`Unexpected request to ${url}`);
  });
}

function deps(fetchImpl: typeof fetch, cwd: string, configPath: string): InstalledDeps {
  return { fetch: fetchImpl, configPath, env: { SKILLSET_REGISTRY: REGISTRY }, cwd, homeDir: cwd };
}

function installDeps(fetchImpl: typeof fetch, cwd: string, configPath: string): InstallDeps {
  return {
    ...deps(fetchImpl, cwd, configPath),
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
  const configDir = await mkdtemp(join(tmpdir(), "skillset-lc-cfg-"));
  const cwd = await mkdtemp(join(tmpdir(), "skillset-lc-cwd-"));
  try {
    return await run({ configPath: join(configDir, "config.json"), cwd });
  } finally {
    await rm(configDir, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
}

const skillMd = (cwd: string) => join(cwd, ".agents", "skills", "code-review", "SKILL.md");

describe("the lockfile `install` writes", () => {
  it("records the Skill at the project root, not inside .agents", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, body: "Body.\n" });
      await runInstall(installDeps(fetchImpl, cwd, configPath), { name: "code-review", scope: "project", agent: "codex" });

      const lockfile = JSON.parse(await readFile(join(cwd, LOCKFILE_NAME), "utf8")) as {
        registry: string;
        skills: Record<string, { id: string; registry_updated_at: string; content_hash: string; agent: string | null }>;
      };
      expect(lockfile.registry).toBe(REGISTRY);
      expect(lockfile.skills["code-review"]).toMatchObject({
        id: "skill-1",
        registry_updated_at: FIRST_PUBLISH,
        agent: "codex",
      });
      expect(lockfile.skills["code-review"]?.content_hash).toStartWith("sha256:");
    });
  });

  // Installing over an existing copy used to replace the directory
  // silently. Without versions to restore from (ADR-0002) those edits are
  // gone for good.
  it("refuses to replace a Skill the User has edited", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, body: "Body.\n" });
      const options = { name: "code-review", scope: "project", agent: "codex" };
      await runInstall(installDeps(fetchImpl, cwd, configPath), options);
      await writeFile(skillMd(cwd), "locally edited\n");

      await expect(runInstall(installDeps(fetchImpl, cwd, configPath), options)).rejects.toThrow(/local changes/);
      expect(await readFile(skillMd(cwd), "utf8")).toBe("locally edited\n");
    });
  });

  it("replaces an edited Skill when --force says to", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, body: "Body.\n" });
      await runInstall(installDeps(fetchImpl, cwd, configPath), { name: "code-review", scope: "project", agent: "codex" });
      await writeFile(skillMd(cwd), "locally edited\n");

      await runInstall(installDeps(fetchImpl, cwd, configPath), {
        name: "code-review",
        scope: "project",
        agent: "codex",
        force: true,
      });
      expect(await readFile(skillMd(cwd), "utf8")).toContain("Body.");
    });
  });
});

describe("runList", () => {
  it("reports nothing installed against an empty project", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, body: "Body.\n" });
      const report = await runList(deps(fetchImpl, cwd, configPath), {});
      expect(report.skills).toEqual([]);
      expect(report.lockfilePath).toBe(join(cwd, LOCKFILE_NAME));
    });
  });

  it("reports a freshly installed Skill as current", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const state = { updatedAt: FIRST_PUBLISH, body: "Body.\n" };
      const { fetch: fetchImpl } = stubRegistry(state);
      await runInstall(installDeps(fetchImpl, cwd, configPath), { name: "code-review", scope: "project", agent: "codex" });

      const report = await runList(deps(fetchImpl, cwd, configPath), {});
      expect(report.skills.map((s) => [s.name, s.status])).toEqual([["code-review", "current"]]);
    });
  });

  it("reports outdated once the Registry has republished", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const state = { updatedAt: FIRST_PUBLISH, body: "Body.\n" };
      const { fetch: fetchImpl } = stubRegistry(state);
      await runInstall(installDeps(fetchImpl, cwd, configPath), { name: "code-review", scope: "project", agent: "codex" });

      state.updatedAt = REPUBLISHED;
      state.body = "Body, revised.\n";

      const report = await runList(deps(fetchImpl, cwd, configPath), {});
      expect(report.skills[0]?.status).toBe("outdated");
    });
  });

  it("reports modified after a local edit", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, body: "Body.\n" });
      await runInstall(installDeps(fetchImpl, cwd, configPath), { name: "code-review", scope: "project", agent: "codex" });
      await writeFile(skillMd(cwd), "locally edited\n");

      const report = await runList(deps(fetchImpl, cwd, configPath), {});
      expect(report.skills[0]?.status).toBe("modified");
    });
  });

  it("reports missing when the files were deleted by hand", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, body: "Body.\n" });
      await runInstall(installDeps(fetchImpl, cwd, configPath), { name: "code-review", scope: "project", agent: "codex" });
      await rm(join(cwd, ".agents", "skills", "code-review"), { recursive: true });

      const report = await runList(deps(fetchImpl, cwd, configPath), {});
      expect(report.skills[0]?.status).toBe("missing");
    });
  });

  // Whether a Skill has been edited is answerable from the filesystem alone,
  // so losing the Registry costs the listing `outdated` and nothing else.
  it("still reports local state with --offline, and consults nothing", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const state = { updatedAt: FIRST_PUBLISH, body: "Body.\n" };
      const { fetch: fetchImpl, calls } = stubRegistry(state);
      await runInstall(installDeps(fetchImpl, cwd, configPath), { name: "code-review", scope: "project", agent: "codex" });
      state.updatedAt = REPUBLISHED;
      const before = calls.length;

      const report = await runList(deps(fetchImpl, cwd, configPath), { offline: true });
      expect(report.offline).toBe(true);
      expect(report.skills[0]?.status).toBe("current");
      expect(calls).toHaveLength(before);
    });
  });
});

describe("runUpdate", () => {
  it("re-downloads an outdated Skill and re-stamps the lockfile", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const state = { updatedAt: FIRST_PUBLISH, body: "Body.\n" };
      const { fetch: fetchImpl } = stubRegistry(state);
      await runInstall(installDeps(fetchImpl, cwd, configPath), { name: "code-review", scope: "project", agent: "codex" });

      state.updatedAt = REPUBLISHED;
      state.body = "Body, revised.\n";
      const outcomes = await runUpdate(deps(fetchImpl, cwd, configPath), {});

      expect(outcomes).toEqual([{ name: "code-review", status: "updated", from: FIRST_PUBLISH, to: REPUBLISHED }]);
      expect(await readFile(skillMd(cwd), "utf8")).toContain("Body, revised.");
      const after = await runList(deps(fetchImpl, cwd, configPath), {});
      expect(after.skills[0]?.status).toBe("current");
    });
  });

  it("leaves a current Skill alone", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, body: "Body.\n" });
      await runInstall(installDeps(fetchImpl, cwd, configPath), { name: "code-review", scope: "project", agent: "codex" });

      expect(await runUpdate(deps(fetchImpl, cwd, configPath), {})).toEqual([
        { name: "code-review", status: "up-to-date" },
      ]);
    });
  });

  it("refuses a locally-modified Skill and leaves the edit in place", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const state = { updatedAt: FIRST_PUBLISH, body: "Body.\n" };
      const { fetch: fetchImpl } = stubRegistry(state);
      await runInstall(installDeps(fetchImpl, cwd, configPath), { name: "code-review", scope: "project", agent: "codex" });
      await writeFile(skillMd(cwd), "locally edited\n");
      state.updatedAt = REPUBLISHED;

      expect(await runUpdate(deps(fetchImpl, cwd, configPath), {})).toEqual([
        { name: "code-review", status: "skipped", reason: "modified" },
      ]);
      expect(await readFile(skillMd(cwd), "utf8")).toBe("locally edited\n");
    });
  });

  it("discards the edit when --force says to", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const state = { updatedAt: FIRST_PUBLISH, body: "Body.\n" };
      const { fetch: fetchImpl } = stubRegistry(state);
      await runInstall(installDeps(fetchImpl, cwd, configPath), { name: "code-review", scope: "project", agent: "codex" });
      await writeFile(skillMd(cwd), "locally edited\n");
      state.updatedAt = REPUBLISHED;
      state.body = "Body, revised.\n";

      const outcomes = await runUpdate(deps(fetchImpl, cwd, configPath), { force: true });
      expect(outcomes[0]?.status).toBe("updated");
      expect(await readFile(skillMd(cwd), "utf8")).toContain("Body, revised.");
    });
  });

  // A lockfile entry with no files is the one case where writing files back
  // is unambiguously what the User wants.
  it("restores a Skill whose files were deleted", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, body: "Body.\n" });
      await runInstall(installDeps(fetchImpl, cwd, configPath), { name: "code-review", scope: "project", agent: "codex" });
      await rm(join(cwd, ".agents", "skills", "code-review"), { recursive: true });

      expect(await runUpdate(deps(fetchImpl, cwd, configPath), {})).toEqual([
        { name: "code-review", status: "restored", to: FIRST_PUBLISH },
      ]);
      expect(await readFile(skillMd(cwd), "utf8")).toContain("Body.");
    });
  });

  it("names a Skill that is not installed rather than silently doing nothing", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, body: "Body.\n" });
      await expect(runUpdate(deps(fetchImpl, cwd, configPath), { names: ["never-installed"] })).rejects.toThrow(
        /Not installed at project scope: never-installed/,
      );
    });
  });
});

describe("runRemove", () => {
  it("removes the files, the Agent's link, and the lockfile entry", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, body: "Body.\n" });
      // claude-code reads its own directory, so this install makes a link
      // there as well as the canonical copy — both have to come out.
      await runInstall(installDeps(fetchImpl, cwd, configPath), { name: "code-review", scope: "project", agent: "claude-code" });

      const report = await runRemove(deps(fetchImpl, cwd, configPath), { name: "code-review" });

      expect(report.skillDirectory).toBe(join(cwd, ".agents", "skills", "code-review"));
      expect(report.link).toBe(join(cwd, ".claude", "skills", "code-review"));
      expect(report.forgotten).toBe(true);
      expect(await Bun.file(join(cwd, LOCKFILE_NAME)).exists()).toBe(false);
      expect(await runList(deps(fetchImpl, cwd, configPath), {})).toMatchObject({ skills: [] });
    });
  });

  it("reports nothing removed for a Skill that was never installed", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, body: "Body.\n" });
      const report = await runRemove(deps(fetchImpl, cwd, configPath), { name: "never-installed" });
      expect(report).toMatchObject({ skillDirectory: null, link: null, forgotten: false });
    });
  });

  // Half-removed state has ordinary causes — a directory deleted by hand —
  // and should still come out cleanly rather than erroring on the missing half.
  it("still drops the lockfile entry when the files are already gone", async () => {
    await withTempDirs(async ({ configPath, cwd }) => {
      const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, body: "Body.\n" });
      await runInstall(installDeps(fetchImpl, cwd, configPath), { name: "code-review", scope: "project", agent: "codex" });
      await rm(join(cwd, ".agents", "skills", "code-review"), { recursive: true });

      const report = await runRemove(deps(fetchImpl, cwd, configPath), { name: "code-review" });
      expect(report).toMatchObject({ skillDirectory: null, forgotten: true });
    });
  });
});
