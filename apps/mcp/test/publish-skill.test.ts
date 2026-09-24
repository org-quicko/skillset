import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { publishSkill, type PublishSkillDeps } from "../src/tools/publish-skill.js";
import { jsonResponse, stubFetch } from "./helpers.js";

const REGISTRY = "https://registry.example";
const STORAGE_BASE = "https://storage.example/bucket";

/** Named so a test can assert on the byte counts `publishSkill` reports back (ISSUE-12). */
const SKILL_MD = "---\nname: code-review\ndescription: Reviews code.\n---\nHow to do the thing.\n";
const HELPER_SH = "#!/bin/sh\necho hi\n";

async function makeSkillDir(extra?: (dir: string) => Promise<void>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "skillset-mcp-publish-"));
  await writeFile(join(dir, "SKILL.md"), SKILL_MD);
  if (extra) await extra(dir);
  return dir;
}

function fakePublished() {
  return {
    skill: {
      id: "skill-1",
      kind: "skill",
      name: "code-review",
      description: "Reviews code.",
      body: "How to do the thing.\n",
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
      installs: 0,
    },
  };
}

/** One presigned destination per file the request declared, in that same order (ADR-0032). */
function uploadFor(requestBody: unknown) {
  const { files } = JSON.parse(String(requestBody)) as { files: { path: string }[] };
  return {
    files: files.map((file) => ({
      path: file.path,
      url: `${STORAGE_BASE}/${file.path}?sig=abc`,
      method: "PUT" as const,
      headers: { "content-type": "application/octet-stream" },
    })),
    expires_in_seconds: 60,
  };
}

function isStorageUrl(url: string): boolean {
  return url.startsWith(`${STORAGE_BASE}/`);
}

function storagePath(url: string): string {
  return url.slice(`${STORAGE_BASE}/`.length, url.indexOf("?"));
}

function baseDeps(overrides: Partial<PublishSkillDeps> & Pick<PublishSkillDeps, "fetchImpl" | "cwd">): PublishSkillDeps {
  return { registry: REGISTRY, token: "writer-token", env: {}, ...overrides };
}

/**
 * `path` is chosen by the *model*, and everything below it is uploaded to a
 * Registry whose reads are unauthenticated — so an escape is a way to publish
 * `~/.ssh` to the whole team, and a prompt injection inside a Skill the Agent
 * just installed is enough to ask for one (ISSUE-12).
 */
describe("publishSkill stays inside the project", () => {
  it("refuses a relative path that climbs out of the project, and makes no network call", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-mcp-contained-"));
    try {
      // A real Skill outside the project, so the refusal is about containment
      // and not about the directory being empty.
      const outside = await makeSkillDir();
      const project = join(root, "project");
      await mkdir(project, { recursive: true });
      const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

      const escape = relative(project, outside).split(sep).join("/");
      await expect(publishSkill(baseDeps({ fetchImpl, cwd: project }), { path: escape })).rejects.toThrow(
        /outside this project/,
      );
      expect(calls).toHaveLength(0);
      await rm(outside, { recursive: true, force: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses an absolute path outside the project", async () => {
    const project = await mkdtemp(join(tmpdir(), "skillset-mcp-contained-"));
    const outside = await makeSkillDir();
    try {
      const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

      await expect(publishSkill(baseDeps({ fetchImpl, cwd: project }), { path: outside })).rejects.toThrow(
        /outside this project/,
      );
      expect(calls).toHaveLength(0);
    } finally {
      await rm(project, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("refuses a symlink that points out of the project, which a string check would walk past", async () => {
    const project = await mkdtemp(join(tmpdir(), "skillset-mcp-contained-"));
    const outside = await makeSkillDir();
    try {
      await symlink(outside, join(project, "skills"), "dir");
      const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

      await expect(publishSkill(baseDeps({ fetchImpl, cwd: project }), { path: "skills" })).rejects.toThrow(
        /outside this project/,
      );
      expect(calls).toHaveLength(0);
    } catch (error) {
      // Creating a directory symlink needs a privilege Windows does not grant
      // by default; the check itself is exercised by the two cases above.
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    } finally {
      await rm(project, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("says so plainly when the path names nothing at all", async () => {
    const project = await mkdtemp(join(tmpdir(), "skillset-mcp-contained-"));
    try {
      const { fetch: fetchImpl } = stubFetch(() => jsonResponse(200, {}));
      await expect(publishSkill(baseDeps({ fetchImpl, cwd: project }), { path: "skills/nope" })).rejects.toThrow(
        /No directory at "skills\/nope"/,
      );
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});

describe("publishSkill", () => {
  it("errors clearly when the directory holds no SKILL.md, and makes no network call", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skillset-mcp-publish-"));
    try {
      const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

      await expect(publishSkill(baseDeps({ fetchImpl, cwd: dir }))).rejects.toThrow(/No SKILL\.md found/);
      expect(calls).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("errors naming the broken rule when the Skill fails local validation, before contacting the Registry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skillset-mcp-publish-"));
    try {
      await writeFile(join(dir, "SKILL.md"), "no frontmatter here\n");
      const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

      await expect(publishSkill(baseDeps({ fetchImpl, cwd: dir }))).rejects.toThrow(/frontmatter/);
      expect(calls).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("publishes the Skill at the project root by default: PUTs metadata with a Bearer Token, then uploads each file", async () => {
    const skillDir = await makeSkillDir(async (dir) => {
      await mkdir(join(dir, "node_modules", "left-pad"), { recursive: true });
      await writeFile(join(dir, "node_modules", "left-pad", "index.js"), "module.exports = {};");
      await mkdir(join(dir, "scripts"), { recursive: true });
      await writeFile(join(dir, "scripts", "helper.sh"), HELPER_SH);
    });
    try {
      const published = fakePublished();
      const uploaded = new Map<string, string>();
      const { fetch: fetchImpl, calls } = stubFetch((url, init) => {
        if (url === `${REGISTRY}/api/resources/skill/code-review`) {
          const body = JSON.parse(String(init?.body));
          expect(body).toMatchObject({ description: "Reviews code.", body: "How to do the thing.\n" });
          return jsonResponse(200, { ...published, upload: uploadFor(init?.body) });
        }
        if (isStorageUrl(url)) {
          uploaded.set(storagePath(url), new TextDecoder().decode(init?.body as Uint8Array));
          return new Response(null, { status: 200 });
        }
        throw new Error(`Unexpected request to ${url}`);
      });

      const result = await publishSkill(baseDeps({ fetchImpl, cwd: skillDir }));

      expect(result).toEqual({
        name: "code-review",
        id: "skill-1",
        published_at: published.skill.published_at,
        source: null,
        // Reported back so whoever reads the Agent's output can see what left
        // the machine (ISSUE-12).
        // In the order they were uploaded, which is the bundle's own order.
        files: [
          { path: "scripts/helper.sh", size: HELPER_SH.length },
          { path: "SKILL.md", size: SKILL_MD.length },
        ],
        total_bytes: SKILL_MD.length + HELPER_SH.length,
      });
      // The metadata PUT, then one PUT per file — and nothing for the excluded `node_modules` tree.
      expect(calls).toHaveLength(3);
      expect(calls[0]?.init?.headers).toMatchObject({ authorization: "Bearer writer-token" });
      expect([...uploaded.keys()].sort()).toEqual(["SKILL.md", "scripts/helper.sh"]);
      expect(uploaded.get("scripts/helper.sh")).toBe(HELPER_SH);
    } finally {
      await rm(skillDir, { recursive: true, force: true });
    }
  });

  it("publishes the Skill at a given path, resolved against cwd", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-mcp-publish-"));
    try {
      await mkdir(join(root, "skills", "code-review"), { recursive: true });
      await writeFile(
        join(root, "skills", "code-review", "SKILL.md"),
        "---\nname: code-review\ndescription: Reviews code.\n---\nHow to do the thing.\n",
      );

      const published = fakePublished();
      const { fetch: fetchImpl } = stubFetch((url, init) => {
        if (url === `${REGISTRY}/api/resources/skill/code-review`) {
          return jsonResponse(200, { ...published, upload: uploadFor(init?.body) });
        }
        if (isStorageUrl(url)) return new Response(null, { status: 200 });
        throw new Error(`Unexpected request to ${url}`);
      });

      const result = await publishSkill(baseDeps({ fetchImpl, cwd: root }), { path: "./skills/code-review" });

      expect(result.name).toBe("code-review");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a reader's Token with a message about permissions, not a generic failure", async () => {
    const skillDir = await makeSkillDir();
    try {
      const { fetch: fetchImpl } = stubFetch(() =>
        jsonResponse(403, { error: { code: "forbidden", message: "Your role (reader) does not allow this." } }),
      );

      await expect(publishSkill(baseDeps({ fetchImpl, cwd: skillDir, token: "reader-token" }))).rejects.toThrow(
        /not allowed to publish — publishing needs the writer role or higher/,
      );
    } finally {
      await rm(skillDir, { recursive: true, force: true });
    }
  });

  it("refuses a rejected Token naming the Token itself, not a generic failure", async () => {
    const skillDir = await makeSkillDir();
    try {
      const { fetch: fetchImpl } = stubFetch(() =>
        jsonResponse(401, { error: { code: "unauthorized", message: "Token rejected." } }),
      );

      await expect(publishSkill(baseDeps({ fetchImpl, cwd: skillDir, token: "stale-token" }))).rejects.toThrow(/Token rejected/);
    } finally {
      await rm(skillDir, { recursive: true, force: true });
    }
  });
});

/**
 * Publishing from a repository clones it with the User's own git, exactly as
 * `skillset publish <url> --name` does (ADR-0044). A bare repository on disk
 * stands in for GitHub through an `insteadOf` rewrite, so the real clone runs
 * and nothing touches the network.
 */
describe("publishSkill from a url", () => {
  const REPO_URL = "https://github.com/acme/skills";
  let remotes: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(async () => {
    remotes = await mkdtemp(join(tmpdir(), "skillset-mcp-remotes-"));
    const work = join(remotes, "work");
    await mkdir(join(work, "skills", "review"), { recursive: true });
    await writeFile(join(work, "skills", "review", "SKILL.md"), SKILL_MD);
    const run = (args: string[], cwd: string) => execFileSync("git", args, { cwd, stdio: "pipe" });
    run(["init", "--quiet", "--initial-branch=main"], work);
    run(["add", "."], work);
    run(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", "skills"], work);
    await mkdir(join(remotes, "acme"), { recursive: true });
    run(["clone", "--quiet", "--bare", work, join(remotes, "acme", "skills.git")], remotes);
    env = {
      ...process.env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.file:///${remotes.replaceAll("\\", "/")}/.insteadOf`,
      GIT_CONFIG_VALUE_0: "https://github.com/",
    };
  });

  afterAll(async () => {
    await rm(remotes, { recursive: true, force: true });
  });

  function stubRegistry() {
    return stubFetch((url, init) => {
      if (url === `${REGISTRY}/api/resources/skill/code-review`) {
        return jsonResponse(200, { ...fakePublished(), upload: uploadFor(init?.body) });
      }
      if (isStorageUrl(url)) return new Response(null, { status: 200 });
      throw new Error(`Unexpected request to ${url}`);
    });
  }

  it("publishes the Skill name picks, recording the repository as its Source", async () => {
    const { fetch: fetchImpl, calls } = stubRegistry();

    const result = await publishSkill(baseDeps({ fetchImpl, cwd: remotes, env }), { url: REPO_URL, name: "code-review" });

    expect(result.source).toBe(REPO_URL);
    const put = calls.find((call) => call.url === `${REGISTRY}/api/resources/skill/code-review`);
    expect((JSON.parse(String(put?.init?.body)) as { source?: string }).source).toBe(REPO_URL);
  });

  it("requires name with url, before cloning or contacting the Registry", async () => {
    const { fetch: fetchImpl, calls } = stubRegistry();

    await expect(publishSkill(baseDeps({ fetchImpl, cwd: remotes, env }), { url: REPO_URL })).rejects.toThrow(
      /Pass name with url/,
    );
    expect(calls).toEqual([]);
  });

  it("names every Skill it found when name matches none", async () => {
    const { fetch: fetchImpl } = stubRegistry();

    await expect(
      publishSkill(baseDeps({ fetchImpl, cwd: remotes, env }), { url: REPO_URL, name: "pdf" }),
    ).rejects.toThrow("found: code-review.");
  });

  it("refuses path and url together, and name without url", async () => {
    const { fetch: fetchImpl, calls } = stubRegistry();

    await expect(
      publishSkill(baseDeps({ fetchImpl, cwd: remotes, env }), { url: REPO_URL, name: "code-review", path: "." }),
    ).rejects.toThrow(/either path or url/);
    await expect(publishSkill(baseDeps({ fetchImpl, cwd: remotes, env }), { name: "code-review" })).rejects.toThrow(
      /name picks a Skill out of a url/,
    );
    expect(calls).toEqual([]);
  });
});
