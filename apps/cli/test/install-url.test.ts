import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { LOCKFILE_NAME, type LockfileEntry } from "@in-org-quicko/skillset-installer";
import { runInstall, type InstallDeps } from "../src/commands/install.js";
import { runList } from "../src/commands/list.js";
import { runUpdate } from "../src/commands/update.js";
import { jsonResponse, stubFetch } from "./helpers.js";

const REGISTRY = "https://registry.example";
const REPO_URL = "https://github.com/acme/skills";
const PDF_MD = "---\nname: pdf\ndescription: Reads PDFs.\n---\nBody.\n";

let remotes: string;

/**
 * Builds `acme/skills` as a bare repository on disk, holding two Skills under
 * `skills/`. Every test then reaches it through `https://github.com/`, which
 * the environment below rewrites to this directory — so the real git clone
 * runs, and nothing touches the network.
 */
beforeAll(async () => {
  remotes = await mkdtemp(join(tmpdir(), "skillset-remotes-"));
  const work = join(remotes, "work");
  await mkdir(join(work, "skills", "pdf", "references"), { recursive: true });
  await mkdir(join(work, "skills", "docx"), { recursive: true });
  await writeFile(join(work, "skills", "pdf", "SKILL.md"), PDF_MD);
  await writeFile(join(work, "skills", "pdf", "references", "forms.md"), "Forms.\n");
  await writeFile(join(work, "skills", "docx", "SKILL.md"), "---\nname: docx\ndescription: Writes documents.\n---\nBody.\n");

  const run = (args: string[], cwd: string) => execFileSync("git", args, { cwd, stdio: "pipe" });
  run(["init", "--quiet", "--initial-branch=main"], work);
  run(["add", "."], work);
  run(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", "skills"], work);
  await mkdir(join(remotes, "acme"), { recursive: true });
  run(["clone", "--quiet", "--bare", work, join(remotes, "acme", "skills.git")], remotes);
});

afterAll(async () => {
  await rm(remotes, { recursive: true, force: true });
});

/** The process environment, with `https://github.com/` rewritten to the bare repositories above. */
function gitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("SKILLSET_")));
  return {
    ...base,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.file:///${remotes.replaceAll("\\", "/")}/.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/",
    SKILLSET_REGISTRY: REGISTRY,
    ...extra,
  };
}

function installDeps(fetchImpl: typeof fetch, cwd: string, env: NodeJS.ProcessEnv): InstallDeps {
  return {
    fetch: fetchImpl,
    configPath: join(cwd, "no-config.json"),
    env,
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

async function withCwd<T>(run: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), "skillset-url-cwd-"));
  try {
    return await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function lockEntry(cwd: string, name: string): Promise<LockfileEntry | undefined> {
  const lockfile = JSON.parse(await readFile(join(cwd, LOCKFILE_NAME), "utf8")) as { skills: Record<string, LockfileEntry> };
  return lockfile.skills[name];
}

const notFound = () => jsonResponse(404, { error: { code: "not_found", message: "No Resource by that id." } });

function approvedSkill(updatedAt: string) {
  return {
    id: "resource-1",
    kind: "skill",
    name: "pdf",
    description: "Reads PDFs.",
    body: "Body.\n",
    published_by: { user_id: "u1", email: "reader@example.com", first_name: "R", last_name: "D" },
    published_at: updatedAt,
    updated_at: updatedAt,
    license: null,
    compatibility: null,
    metadata: null,
    allowed_tools: null,
    namespace: "acme/skills",
    source: REPO_URL,
    tags: [],
    installs: 0,
  };
}

describe("installing from a repository URL", () => {
  it("clones just the folder the URL names and installs its Skill, recording where it came from", async () => {
    await withCwd(async (cwd) => {
      const { fetch: fetchImpl, calls } = stubFetch(() => {
        throw new Error("no Registry request expected without a Token");
      });

      const report = await runInstall(installDeps(fetchImpl, cwd, gitEnv()), {
        name: `${REPO_URL}/tree/main/skills/pdf`,
        scope: "project",
        agent: "codex",
      });

      expect(await readFile(join(cwd, ".agents", "skills", "pdf", "SKILL.md"), "utf8")).toBe(PDF_MD);
      expect(await readFile(join(cwd, ".agents", "skills", "pdf", "references", "forms.md"), "utf8")).toBe("Forms.\n");
      expect(report.submission).toEqual({ status: "not-logged-in" });
      expect(calls).toEqual([]);
      expect(await lockEntry(cwd, "pdf")).toMatchObject({
        id: null,
        namespace: "acme/skills",
        registry_updated_at: null,
        source: REPO_URL,
      });
    });
  });

  it("submits the Skill for approval when a Token is configured", async () => {
    await withCwd(async (cwd) => {
      const { fetch: fetchImpl, calls } = stubFetch((url, init) => {
        if (url === `${REGISTRY}/api/submissions/skill/pdf` && init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as { files: { path: string }[] };
          return jsonResponse(200, {
            submission: {
              id: "submission-1",
              kind: "skill",
              namespace: "acme/skills",
              name: "pdf",
              description: "Reads PDFs.",
              body: "Body.\n",
              source: REPO_URL,
              allowed_tools: null,
              submitted_by_email: "reader@example.com",
              submitted_by_name: "R D",
              submitted_at: new Date().toISOString(),
            },
            upload: {
              files: body.files.map((file) => ({
                path: file.path,
                url: `https://storage.example/${file.path}`,
                method: "PUT",
                headers: {},
              })),
              expires_in_seconds: 900,
            },
          });
        }
        if (url.startsWith("https://storage.example/")) return new Response(null, { status: 200 });
        throw new Error(`Unexpected request to ${url}`);
      });

      const report = await runInstall(installDeps(fetchImpl, cwd, gitEnv({ SKILLSET_TOKEN: "t" })), {
        name: `${REPO_URL}/tree/main/skills/pdf`,
        scope: "project",
        agent: "codex",
      });

      expect(report.submission).toEqual({ status: "submitted", id: "submission-1" });
      const submitted = JSON.parse(String(calls[0]?.init?.body)) as { source: string };
      expect(submitted.source).toBe(REPO_URL);
      expect(calls.filter((call) => call.url.startsWith("https://storage.example/")).map((call) => call.url).sort()).toEqual([
        "https://storage.example/SKILL.md",
        "https://storage.example/references/forms.md",
      ]);
    });
  });

  it("installs anyway, reporting it, when the Registry already has the Skill", async () => {
    await withCwd(async (cwd) => {
      const { fetch: fetchImpl } = stubFetch(() =>
        jsonResponse(409, { error: { code: "already_published", message: "acme/skills/pdf is already in the Registry." } }),
      );

      const report = await runInstall(installDeps(fetchImpl, cwd, gitEnv({ SKILLSET_TOKEN: "t" })), {
        name: `${REPO_URL}/tree/main/skills/pdf`,
        scope: "project",
        agent: "codex",
      });

      expect(report.submission).toEqual({ status: "already-published" });
      expect(await lockEntry(cwd, "pdf")).toBeDefined();
    });
  });

  it("refuses a URL holding more than one Skill, naming each", async () => {
    await withCwd(async (cwd) => {
      const { fetch: fetchImpl } = stubFetch(() => notFound());

      await expect(
        runInstall(installDeps(fetchImpl, cwd, gitEnv()), { name: REPO_URL, scope: "project", agent: "codex" }),
      ).rejects.toThrow(/holds 2 Skills — point at one of: skills\/docx, skills\/pdf/);
    });
  });

  it("names git's own failure when the repository cannot be cloned", async () => {
    await withCwd(async (cwd) => {
      const { fetch: fetchImpl } = stubFetch(() => notFound());

      await expect(
        runInstall(installDeps(fetchImpl, cwd, gitEnv()), {
          name: "https://github.com/acme/missing",
          scope: "project",
          agent: "codex",
        }),
      ).rejects.toThrow(/does not exist|not found|not appear to be a git repository/i);
    });
  });

  it("reports progress around the clone, and fails it when git does", async () => {
    await withCwd(async (cwd) => {
      const { fetch: fetchImpl } = stubFetch(() => notFound());
      const events: string[] = [];
      const progress = {
        start: (message: string) => events.push(`start ${message}`),
        stop: (message: string) => events.push(`stop ${message}`),
        fail: (message: string) => events.push(`fail ${message}`),
      };

      await runInstall(
        { ...installDeps(fetchImpl, cwd, gitEnv()), progress },
        { name: `${REPO_URL}/tree/main/skills/pdf`, scope: "project", agent: "codex" },
      );
      expect(events).toEqual([`start Cloning ${REPO_URL}`, `stop Cloned ${REPO_URL}`]);

      events.length = 0;
      await expect(
        runInstall(
          { ...installDeps(fetchImpl, cwd, gitEnv()), progress },
          { name: "https://github.com/acme/missing", scope: "project", agent: "codex" },
        ),
      ).rejects.toThrow();
      expect(events).toEqual(["start Cloning https://github.com/acme/missing", "fail Could not clone https://github.com/acme/missing"]);
    });
  });

  it("refuses --namespace alongside a URL", async () => {
    await withCwd(async (cwd) => {
      const { fetch: fetchImpl } = stubFetch(() => notFound());

      await expect(
        runInstall(installDeps(fetchImpl, cwd, gitEnv()), {
          name: `${REPO_URL}/tree/main/skills/pdf`,
          namespace: "acme/skills",
          scope: "project",
        }),
      ).rejects.toThrow(/--namespace/);
    });
  });
});

describe("a URL-installed Skill once its Submission is approved", () => {
  it("reads pending until approved, then moves onto the Registry's copy on update", async () => {
    await withCwd(async (cwd) => {
      const state = { approved: false };
      const { fetch: fetchImpl, calls } = stubFetch((url) => {
        if (url === `${REGISTRY}/api/resources/skill/by-name/pdf?namespace=acme%2Fskills`) {
          return state.approved ? jsonResponse(200, approvedSkill("2026-09-22T00:00:00.000Z")) : notFound();
        }
        if (url.startsWith(`${REGISTRY}/api/resources/resource-1/artifact`)) {
          return new Response(zipPdf(), { status: 200 });
        }
        throw new Error(`Unexpected request to ${url}`);
      });
      const deps = installDeps(fetchImpl, cwd, gitEnv());
      await runInstall(deps, { name: `${REPO_URL}/tree/main/skills/pdf`, scope: "project", agent: "codex" });

      expect((await runList(deps, {})).skills[0]?.status).toBe("current");
      expect(await runUpdate(deps, {})).toEqual([{ name: "pdf", status: "pending" }]);

      state.approved = true;
      expect((await runList(deps, {})).skills[0]?.status).toBe("outdated");
      const [outcome] = await runUpdate(deps, {});
      expect(outcome).toMatchObject({ name: "pdf", status: "updated", from: null });
      expect(await lockEntry(cwd, "pdf")).toMatchObject({ id: "resource-1", namespace: "acme/skills" });
      expect(calls.every((call) => !call.url.includes("by-name/pdf") || call.url.includes("namespace=acme%2Fskills"))).toBe(true);
    });
  });
});

function zipPdf(): Uint8Array {
  return zipSync({ "SKILL.md": new TextEncoder().encode(PDF_MD) });
}
