import { describe, expect, it } from "bun:test";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { type AgentId, SkillSchema } from "@in-org-quicko/skillset-shared";
import { addSkills, buildFallbackOutcome, type AddSkillOutcome, type AddSkillsDeps } from "../src/tools/add-skills.js";
import { jsonResponse, stubFetch, type RecordedCall } from "./helpers.js";

const encoder = new TextEncoder();
const REGISTRY = "https://registry.example";

function fakeSkill(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "skill-1",
    kind: "skill",
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

function validArtifactZip(body = "Body.\n"): Uint8Array {
  return zipSync({ "SKILL.md": encoder.encode(`---\nname: code-review\ndescription: Reviews code.\n---\n${body}`) });
}

interface RegistryStubOptions {
  skill?: Record<string, unknown>;
  artifact?: Uint8Array;
  artifactStatus?: number;
}

/** Answers the two requests a normal install makes: the Skill's metadata, then its Artifact. */
function stubRegistry(options: RegistryStubOptions = {}) {
  const skill = options.skill ?? fakeSkill();
  const artifact = options.artifact ?? validArtifactZip();
  const artifactStatus = options.artifactStatus ?? 200;
  return stubFetch((url) => {
    if (url === `${REGISTRY}/api/resources/skill/by-name/${skill.name}`) return jsonResponse(200, skill);
    if (url === `${REGISTRY}/api/resources/${skill.id}/artifact?source=mcp`) {
      return artifactStatus === 200 ? new Response(artifact, { status: 200 }) : new Response("nope", { status: artifactStatus });
    }
    throw new Error(`Unexpected request to ${url}`);
  });
}

async function withTempRoots<T>(run: (roots: { cwd: string; homeDir: string }) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), "skillset-mcp-add-cwd-"));
  const homeDir = await mkdtemp(join(tmpdir(), "skillset-mcp-add-home-"));
  try {
    return await run({ cwd, homeDir });
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  }
}

function baseDeps(
  overrides: Partial<Omit<AddSkillsDeps, "detection">> & {
    fetchImpl: typeof fetch;
    ctx: AddSkillsDeps["ctx"];
    /** Convenience: the resolved Agent, wrapped into a `detection` for the deps. */
    agentId?: AgentId | null;
  },
): AddSkillsDeps {
  const { agentId = "claude-code", ...rest } = overrides;
  return {
    registry: REGISTRY,
    scope: "project",
    detection: { agentId, step: "override" },
    overwrite: false,
    ...rest,
  };
}

/** Runs {@link addSkills} and returns just the per-Skill outcomes — the shape most tests assert on. */
async function addSkillsOutcomes(deps: AddSkillsDeps, names: readonly string[]): Promise<AddSkillOutcome[]> {
  return (await addSkills(deps, names)).outcomes;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("addSkills — a normal install", () => {
  it("writes the Artifact's files into the canonical directory and links the Agent's own directory", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const { fetch: fetchImpl } = stubRegistry();

      const [outcome] = await addSkillsOutcomes(baseDeps({ fetchImpl, ctx: { cwd, env: {}, homeDir } }), ["code-review"]);

      expect(outcome).toMatchObject({ name: "code-review", status: "installed" });
      if (outcome?.status !== "installed") throw new Error("expected installed");
      expect(outcome.skillDirectory).toBe(join(cwd, ".agents", "skills", "code-review"));
      expect(outcome.link).toEqual({ kind: "symlink", path: join(cwd, ".claude", "skills", "code-review") });
      expect(await readFile(join(outcome.skillDirectory, "SKILL.md"), "utf8")).toContain("code-review");
      expect(outcome.skillMdBody).toBe("Body.\n");
      expect(outcome.note).toContain("next session");
    });
  });

  it("reports which other Agents the same directory already serves", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const { fetch: fetchImpl } = stubRegistry();

      const [outcome] = await addSkillsOutcomes(baseDeps({ fetchImpl, ctx: { cwd, env: {}, homeDir }, agentId: "codex" }), [
        "code-review",
      ]);

      if (outcome?.status !== "installed") throw new Error("expected installed");
      expect(outcome.alsoServes.length).toBeGreaterThan(1);
      expect(outcome.alsoServes).toContain("cline");
    });
  });

  it("records an Install by requesting the Artifact with source=mcp", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const { fetch: fetchImpl, calls } = stubRegistry();

      await addSkillsOutcomes(baseDeps({ fetchImpl, ctx: { cwd, env: {}, homeDir } }), ["code-review"]);

      const artifactCall = calls.find((call) => call.url.includes("/artifact"));
      expect(artifactCall?.url).toBe(`${REGISTRY}/api/resources/skill-1/artifact?source=mcp`);
    });
  });

  it("sends no authorization header on any request", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const { fetch: fetchImpl, calls } = stubRegistry();

      await addSkillsOutcomes(baseDeps({ fetchImpl, ctx: { cwd, env: {}, homeDir } }), ["code-review"]);

      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls as RecordedCall[]) {
        expect(call.init?.headers).toBeUndefined();
      }
    });
  });
});

describe("addSkills — batching", () => {
  it("returns one outcome per Skill, in order", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const skillA = fakeSkill({ id: "skill-a", name: "skill-a" });
      const skillB = fakeSkill({ id: "skill-b", name: "skill-b" });
      const { fetch: fetchImpl } = stubFetch((url) => {
        if (url.endsWith("/skill/by-name/skill-a")) return jsonResponse(200, skillA);
        if (url.endsWith("/skill/by-name/skill-b")) return jsonResponse(200, skillB);
        if (url.includes("skill-a/artifact")) return new Response(validArtifactZip(), { status: 200 });
        if (url.includes("skill-b/artifact")) return new Response(validArtifactZip(), { status: 200 });
        throw new Error(`Unexpected request to ${url}`);
      });

      const outcomes = await addSkillsOutcomes(baseDeps({ fetchImpl, ctx: { cwd, env: {}, homeDir } }), ["skill-a", "skill-b"]);

      expect(outcomes.map((o) => o.name)).toEqual(["skill-a", "skill-b"]);
      expect(outcomes.every((o) => o.status === "installed")).toBe(true);
    });
  });

  it("one Skill failing to resolve does not prevent the others in the batch from installing", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const { fetch: fetchImpl } = stubFetch((url) => {
        if (url.endsWith("/skill/by-name/code-review")) return jsonResponse(200, fakeSkill());
        if (url.includes("skill-1/artifact")) return new Response(validArtifactZip(), { status: 200 });
        if (url.endsWith("/skill/by-name/typo-name")) return new Response("not found", { status: 404 });
        throw new Error(`Unexpected request to ${url}`);
      });

      const outcomes = await addSkillsOutcomes(baseDeps({ fetchImpl, ctx: { cwd, env: {}, homeDir } }), [
        "typo-name",
        "code-review",
      ]);

      expect(outcomes[0]).toMatchObject({ name: "typo-name", status: "error" });
      expect(outcomes[1]).toMatchObject({ name: "code-review", status: "installed" });
    });
  });
});

describe("addSkills — an already-installed Skill", () => {
  it("refuses when the target exists and overwrite was not requested, naming the Skill", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const { fetch: fetchImpl } = stubRegistry();
      await addSkillsOutcomes(baseDeps({ fetchImpl, ctx: { cwd, env: {}, homeDir } }), ["code-review"]);

      const { fetch: secondFetch, calls } = stubRegistry();
      const outcomes = await addSkillsOutcomes(baseDeps({ fetchImpl: secondFetch, ctx: { cwd, env: {}, homeDir } }), ["code-review"]);

      expect(outcomes[0]).toEqual({ name: "code-review", status: "refused", existing: "code-review" });
      // Refused before any download: only the by-name lookup was made.
      expect(calls.some((call) => call.url.includes("/artifact"))).toBe(false);
    });
  });

  it("leaves the existing directory byte-for-byte unchanged when refused", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const { fetch: firstFetch } = stubRegistry();
      await addSkillsOutcomes(baseDeps({ fetchImpl: firstFetch, ctx: { cwd, env: {}, homeDir } }), ["code-review"]);
      const before = await readFile(join(cwd, ".agents", "skills", "code-review", "SKILL.md"), "utf8");

      const { fetch: secondFetch } = stubRegistry({ artifact: validArtifactZip("Different body.\n") });
      await addSkillsOutcomes(baseDeps({ fetchImpl: secondFetch, ctx: { cwd, env: {}, homeDir } }), ["code-review"]);

      const after = await readFile(join(cwd, ".agents", "skills", "code-review", "SKILL.md"), "utf8");
      expect(after).toBe(before);
    });
  });

  it("overwrite replaces the target completely — no file from the previous version survives", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const firstZip = zipSync({
        "SKILL.md": encoder.encode("---\nname: code-review\ndescription: Reviews code.\n---\nOld body.\n"),
        "old-only.txt": encoder.encode("stale"),
      });
      const { fetch: firstFetch } = stubRegistry({ artifact: firstZip });
      await addSkillsOutcomes(baseDeps({ fetchImpl: firstFetch, ctx: { cwd, env: {}, homeDir } }), ["code-review"]);
      expect(await exists(join(cwd, ".agents", "skills", "code-review", "old-only.txt"))).toBe(true);

      const { fetch: secondFetch } = stubRegistry({ artifact: validArtifactZip("New body.\n") });
      const outcomes = await addSkillsOutcomes(
        baseDeps({ fetchImpl: secondFetch, ctx: { cwd, env: {}, homeDir }, overwrite: true }),
        ["code-review"],
      );

      expect(outcomes[0]?.status).toBe("installed");
      expect(await readFile(join(cwd, ".agents", "skills", "code-review", "SKILL.md"), "utf8")).toContain("New body.");
      expect(await exists(join(cwd, ".agents", "skills", "code-review", "old-only.txt"))).toBe(false);
    });
  });
});

describe("addSkills — a failed download or a bad Artifact", () => {
  it("a failed download leaves no directory at the target", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const { fetch: fetchImpl } = stubRegistry({ artifactStatus: 500 });

      const [outcome] = await addSkillsOutcomes(baseDeps({ fetchImpl, ctx: { cwd, env: {}, homeDir } }), ["code-review"]);

      expect(outcome?.status).toBe("error");
      expect(await exists(join(cwd, ".agents", "skills", "code-review"))).toBe(false);
    });
  });

  it("an Artifact that fails validation leaves no directory at the target, naming the rule broken", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const badZip = zipSync({ "../../escape.txt": encoder.encode("hostile") });
      const { fetch: fetchImpl } = stubRegistry({ artifact: badZip });

      const [outcome] = await addSkillsOutcomes(baseDeps({ fetchImpl, ctx: { cwd, env: {}, homeDir } }), ["code-review"]);

      expect(outcome?.status).toBe("error");
      if (outcome?.status !== "error") throw new Error("expected error");
      expect(outcome.message).toMatch(/entry_/);
      expect(await exists(join(cwd, ".agents", "skills", "code-review"))).toBe(false);
    });
  });
});

describe("addSkills — an Agent with no directory at this Scope", () => {
  // The current hand-curated Agent table (ADR-0031) has no row whose directory resolves to
  // `null`, so the fallback branch cannot be driven end-to-end through a real Agent id — the
  // same reason installer's own tests don't exercise `installSkill`'s equivalent throw. What
  // *is* directly testable, and what the spec's acceptance criteria actually care about, is
  // the shape of the fallback result once that branch is taken — covered here against
  // `buildFallbackOutcome` itself, the pure function `addOneSkill` calls into for it.
  it("carries the Artifact's location, the Manifest, the intended directory, and the SKILL.md body", () => {
    const skill = SkillSchema.parse(fakeSkill());
    const manifest = { files: [{ path: "SKILL.md", size: 42 }] };

    const outcome = buildFallbackOutcome("code-review", skill, REGISTRY, "/repo/.agents/skills/code-review", manifest);

    expect(outcome).toEqual({
      name: "code-review",
      status: "fallback",
      artifactLocation: `${REGISTRY}/api/resources/skill-1/artifact`,
      manifest,
      intendedDirectory: "/repo/.agents/skills/code-review",
      skillMdBody: "Body.\n",
    });
  });
});

describe("addSkills — no Agent detected (canonical fallback)", () => {
  it("writes the canonical directory and links nothing", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const { fetch: fetchImpl } = stubRegistry();

      const [outcome] = await addSkillsOutcomes(
        baseDeps({ fetchImpl, ctx: { cwd, env: {}, homeDir }, agentId: null }),
        ["code-review"],
      );

      if (outcome?.status !== "installed") throw new Error("expected installed");
      expect(outcome.skillDirectory).toBe(join(cwd, ".agents", "skills", "code-review"));
      expect(outcome.link).toEqual({ kind: "canonical" });
      expect(outcome.alsoServes).toEqual([]);
      expect(await exists(join(cwd, ".claude", "skills", "code-review"))).toBe(false);
    });
  });

  it("echoes the detection back on the batch result", async () => {
    await withTempRoots(async ({ cwd, homeDir }) => {
      const { fetch: fetchImpl } = stubRegistry();
      const deps = baseDeps({ fetchImpl, ctx: { cwd, env: {}, homeDir }, agentId: null });
      deps.detection = { agentId: null, step: "canonical-fallback" };

      const result = await addSkills(deps, ["code-review"]);

      expect(result.detection).toEqual({ agentId: null, step: "canonical-fallback" });
      expect(result.outcomes).toHaveLength(1);
    });
  });
});
