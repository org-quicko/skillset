import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import type { AgentDetection } from "@in-org-quicko/skillset-shared";
import { LOCKFILE_NAME } from "@in-org-quicko/skillset-installer";
import { installSkills } from "../src/tools/install-skills.js";
import { installedSkills, removeSkills, updateSkills } from "../src/tools/lifecycle.js";
import { readSkill } from "../src/tools/read-skill.js";
import { jsonResponse, stubFetch } from "./helpers.js";

const encoder = new TextEncoder();
const REGISTRY = "https://registry.example";
const FIRST_PUBLISH = "2026-09-01T00:00:00.000Z";
const REPUBLISHED = "2026-09-20T00:00:00.000Z";
const DETECTION: AgentDetection = { agentId: "codex", step: "override" };

function fakeSkill(updatedAt: string, overrides: Partial<Record<string, unknown>> = {}) {
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
    installs: 3,
    ...overrides,
  };
}

function artifact(body: string): Uint8Array {
  return zipSync({
    "SKILL.md": encoder.encode(`---\nname: code-review\ndescription: Reviews code.\n---\n${body}`),
  });
}

/** A Registry holding one Skill, whose state the test moves to stand for a republish. */
function stubRegistry(state: { updatedAt: string; body: string }, files: { path: string; size: number }[] = []) {
  return stubFetch((url) => {
    if (url === `${REGISTRY}/api/resources/skill/by-name/code-review`) {
      return jsonResponse(200, fakeSkill(state.updatedAt));
    }
    if (url === `${REGISTRY}/api/resources/skill-1/files`) return jsonResponse(200, { files });
    if (url.startsWith(`${REGISTRY}/api/resources/skill-1/artifact`)) {
      return new Response(artifact(state.body), { status: 200 });
    }
    if (url.startsWith(`${REGISTRY}/api/resources/skill/by-name/`)) {
      return jsonResponse(404, { error: { code: "not_found", message: "No Resource by that id." } });
    }
    throw new Error(`Unexpected request to ${url}`);
  });
}

async function withTempRoots<T>(run: (roots: { cwd: string; homeDir: string }) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), "skillset-mcp-lc-cwd-"));
  const homeDir = await mkdtemp(join(tmpdir(), "skillset-mcp-lc-home-"));
  try {
    return await run({ cwd, homeDir });
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  }
}

const skillMd = (cwd: string) => join(cwd, ".agents", "skills", "code-review", "SKILL.md");

async function install(fetchImpl: typeof fetch, cwd: string, homeDir: string) {
  return installSkills(
    { fetchImpl, registry: REGISTRY, ctx: { cwd, env: {}, homeDir }, scope: "project", detection: DETECTION, overwrite: false },
    ["code-review"],
  );
}

function deps(fetchImpl: typeof fetch, cwd: string, homeDir: string) {
  return { fetchImpl, registry: REGISTRY, ctx: { cwd, env: {}, homeDir }, scope: "project" as const };
}

describe("readSkill", () => {
  // The gap this closes: the only way to see what a Skill said was to
  // install it, which writes to the user's project.
  it("returns the body and file list without touching the Artifact endpoint", async () => {
    const { fetch: fetchImpl, calls } = stubRegistry({ updatedAt: FIRST_PUBLISH, body: "Body.\n" }, [
      { path: "SKILL.md", size: 42 },
      { path: "references/java.md", size: 900 },
    ]);

    const skill = await readSkill(fetchImpl, REGISTRY, "code-review");

    expect(skill).toMatchObject({ name: "code-review", body: "Body.\n", updated_at: FIRST_PUBLISH });
    expect(skill.files.map((file) => file.path)).toEqual(["SKILL.md", "references/java.md"]);
    // No Install may be recorded by a read (ADR-0028), and only the zip
    // endpoint records one.
    expect(calls.some((call) => call.url.includes("/artifact"))).toBe(false);
  });

  it("points at search_skills when there is no such Skill", async () => {
    const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, body: "Body.\n" });
    await expect(readSkill(fetchImpl, REGISTRY, "no-such-skill")).rejects.toThrow(/search_skills/);
  });
});

describe("installedSkills", () => {
  it("reports nothing for a project with no lockfile", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, body: "Body.\n" });
      expect(await installedSkills(deps(fetchImpl, cwd, homeDir))).toEqual([]);
    });
  });

  it("reports a freshly installed Skill as current", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, body: "Body.\n" });
      await install(fetchImpl, cwd, homeDir);

      expect(await installedSkills(deps(fetchImpl, cwd, homeDir))).toMatchObject([
        { name: "code-review", status: "current", registry_updated_at: FIRST_PUBLISH },
      ]);
    });
  });

  it("reports outdated once the Registry has republished", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const state = { updatedAt: FIRST_PUBLISH, body: "Body.\n" };
      const { fetch: fetchImpl } = stubRegistry(state);
      await install(fetchImpl, cwd, homeDir);
      state.updatedAt = REPUBLISHED;

      expect(await installedSkills(deps(fetchImpl, cwd, homeDir))).toMatchObject([
        { name: "code-review", status: "outdated", registry_updated_at: REPUBLISHED },
      ]);
    });
  });

  it("reports modified after a local edit", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, body: "Body.\n" });
      await install(fetchImpl, cwd, homeDir);
      await writeFile(skillMd(cwd), "locally edited\n");

      expect(await installedSkills(deps(fetchImpl, cwd, homeDir))).toMatchObject([{ status: "modified" }]);
    });
  });
});

describe("updateSkills", () => {
  it("re-downloads an outdated Skill", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const state = { updatedAt: FIRST_PUBLISH, body: "Body.\n" };
      const { fetch: fetchImpl } = stubRegistry(state);
      await install(fetchImpl, cwd, homeDir);
      state.updatedAt = REPUBLISHED;
      state.body = "Body, revised.\n";

      const result = await updateSkills({ ...deps(fetchImpl, cwd, homeDir), detection: DETECTION }, {});

      expect(result.outcomes).toMatchObject([{ name: "code-review", status: "installed" }]);
      expect(await readFile(skillMd(cwd), "utf8")).toContain("Body, revised.");
      expect(await installedSkills(deps(fetchImpl, cwd, homeDir))).toMatchObject([{ status: "current" }]);
    });
  });

  it("does nothing when everything is current", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, body: "Body.\n" });
      await install(fetchImpl, cwd, homeDir);

      expect((await updateSkills({ ...deps(fetchImpl, cwd, homeDir), detection: DETECTION }, {})).outcomes).toEqual([]);
    });
  });

  // An update cannot be undone without versions (ADR-0002), so discarding
  // someone's edits has to be something they asked for.
  it("refuses a locally-modified Skill and leaves the edit in place", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const state = { updatedAt: FIRST_PUBLISH, body: "Body.\n" };
      const { fetch: fetchImpl } = stubRegistry(state);
      await install(fetchImpl, cwd, homeDir);
      await writeFile(skillMd(cwd), "locally edited\n");
      state.updatedAt = REPUBLISHED;

      const result = await updateSkills({ ...deps(fetchImpl, cwd, homeDir), detection: DETECTION }, {});

      expect(result.outcomes).toMatchObject([{ name: "code-review", status: "refused" }]);
      expect(await readFile(skillMd(cwd), "utf8")).toBe("locally edited\n");
    });
  });

  it("discards the edit when force says to", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const state = { updatedAt: FIRST_PUBLISH, body: "Body.\n" };
      const { fetch: fetchImpl } = stubRegistry(state);
      await install(fetchImpl, cwd, homeDir);
      await writeFile(skillMd(cwd), "locally edited\n");
      state.updatedAt = REPUBLISHED;
      state.body = "Body, revised.\n";

      const result = await updateSkills({ ...deps(fetchImpl, cwd, homeDir), detection: DETECTION }, { force: true });

      expect(result.outcomes).toMatchObject([{ status: "installed" }]);
      expect(await readFile(skillMd(cwd), "utf8")).toContain("Body, revised.");
    });
  });

  it("restores a Skill whose files were deleted", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, body: "Body.\n" });
      await install(fetchImpl, cwd, homeDir);
      await rm(join(cwd, ".agents", "skills", "code-review"), { recursive: true });

      const result = await updateSkills({ ...deps(fetchImpl, cwd, homeDir), detection: DETECTION }, {});

      expect(result.outcomes).toMatchObject([{ status: "installed" }]);
      expect(await readFile(skillMd(cwd), "utf8")).toContain("Body.");
    });
  });
});

describe("removeSkills", () => {
  it("removes the files and the lockfile entry", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const { fetch: fetchImpl } = stubRegistry({ updatedAt: FIRST_PUBLISH, body: "Body.\n" });
      await install(fetchImpl, cwd, homeDir);

      const outcomes = await removeSkills({ ctx: { cwd, env: {}, homeDir }, scope: "project" }, ["code-review"]);

      expect(outcomes).toMatchObject([{ name: "code-review", status: "removed" }]);
      expect(await Bun.file(join(cwd, LOCKFILE_NAME)).exists()).toBe(false);
      expect(await installedSkills(deps(fetchImpl, cwd, homeDir))).toEqual([]);
    });
  });

  it("reports not-installed rather than failing, so removing twice is harmless", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const outcomes = await removeSkills({ ctx: { cwd, env: {}, homeDir }, scope: "project" }, ["never-installed"]);
      expect(outcomes).toEqual([{ name: "never-installed", status: "not-installed" }]);
    });
  });
});
