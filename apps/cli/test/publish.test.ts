import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { runPublish, type PublishDeps, type PublishOutcome, type PublishResult } from "../src/commands/publish.js";
import { writeConfig } from "../src/config.js";
import { jsonResponse, stubFetch } from "./helpers.js";

async function makeSkillDir(extra?: (dir: string) => Promise<void>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
  await writeFile(
    join(dir, "SKILL.md"),
    "---\nname: code-review\ndescription: Reviews code.\n---\nHow to do the thing.\n",
  );
  if (extra) await extra(dir);
  return dir;
}

/** Writes a minimal, valid `SKILL.md` at `dir/relativePath/SKILL.md`, creating directories as needed. */
async function writeSkillAt(root: string, relativePath: string, name: string): Promise<void> {
  const dir = join(root, ...relativePath.split("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: A Skill.\n---\nBody.\n`);
}

/** `PublishDeps` for a test: a terminal is attached and confirmation defaults to "yes", both overridable. */
function testDeps(overrides: Partial<PublishDeps> & Pick<PublishDeps, "fetch" | "configPath" | "cwd">): PublishDeps {
  return { env: {}, isTTY: true, confirm: async () => true, ...overrides };
}

/** Narrows `runPublish`'s result to the single-Skill shape a test expects. */
function asResult(value: PublishResult | PublishOutcome[]): PublishResult {
  if (Array.isArray(value)) throw new Error("Expected a single PublishResult, got a PublishOutcome[].");
  return value;
}

/** Narrows `runPublish`'s result to the multi-Skill shape a test expects. */
function asOutcomes(value: PublishResult | PublishOutcome[]): PublishOutcome[] {
  if (!Array.isArray(value)) throw new Error("Expected a PublishOutcome[], got a single PublishResult.");
  return value;
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
      license: null,
      compatibility: null,
      metadata: null,
      allowed_tools: null,
      tags: [],
      installs: 0,
    },
    upload: {
      url: "https://storage.example/bucket/code-review.zip?sig=abc",
      method: "PUT",
      headers: { "content-type": "application/zip" },
      expires_in_seconds: 60,
    },
  };
}

describe("runPublish", () => {
  it("errors clearly when nothing under the path holds a SKILL.md, and makes no network call", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
    try {
      const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));
      await expect(
        runPublish(testDeps({ fetch: fetchImpl, configPath: join(dir, "config.json"), cwd: dir }), {}),
      ).rejects.toThrow(/No Skill found/);
      expect(calls).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("errors clearly when not logged in, after local validation passes", async () => {
    const skillDir = await makeSkillDir();
    try {
      const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));
      await expect(
        runPublish(testDeps({ fetch: fetchImpl, configPath: join(skillDir, "config.json"), cwd: skillDir }), {}),
      ).rejects.toThrow(/Not logged in/);
      expect(calls).toHaveLength(0);
    } finally {
      await rm(skillDir, { recursive: true, force: true });
    }
  });

  it("publishes: PUTs metadata, then PUTs the Artifact to the presigned URL, excluding node_modules", async () => {
    const skillDir = await makeSkillDir(async (dir) => {
      await mkdir(join(dir, "node_modules", "left-pad"), { recursive: true });
      await writeFile(join(dir, "node_modules", "left-pad", "index.js"), "module.exports = {};");
      await mkdir(join(dir, "scripts"), { recursive: true });
      await writeFile(join(dir, "scripts", "helper.sh"), "#!/bin/sh\necho hi\n");
    });
    const configDir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
    try {
      const configPath = join(configDir, "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "writer-token" });

      const published = fakePublished();
      let uploadedBody: Uint8Array | undefined;
      const { fetch: fetchImpl, calls } = stubFetch((url, init) => {
        if (url === "https://registry.example/api/resources/skill/code-review") {
          const body = JSON.parse(String(init?.body));
          expect(body).toMatchObject({ description: "Reviews code.", body: "How to do the thing.\n" });
          return jsonResponse(200, published);
        }
        if (url === "https://storage.example/bucket/code-review.zip?sig=abc") {
          uploadedBody = init?.body as Uint8Array;
          return new Response(null, { status: 200 });
        }
        throw new Error(`Unexpected request to ${url}`);
      });

      const result = asResult(await runPublish(testDeps({ fetch: fetchImpl, configPath, cwd: skillDir }), {}));

      expect(result).toEqual({ name: "code-review", id: "skill-1", published_at: published.skill.published_at });
      expect(calls).toHaveLength(2);
      expect(calls[0]?.init?.headers).toMatchObject({ authorization: "Bearer writer-token" });
      expect(calls[1]?.init?.headers).toMatchObject({ "content-type": "application/zip" });

      const entries = Object.keys(unzipSync(uploadedBody!)).sort();
      expect(entries).toEqual(["SKILL.md", "scripts/helper.sh"]);
    } finally {
      await rm(skillDir, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("refuses a reader's Token with a message about permissions, not a generic failure", async () => {
    const skillDir = await makeSkillDir();
    const configDir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
    try {
      const configPath = join(configDir, "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "reader-token" });

      const { fetch: fetchImpl } = stubFetch(() =>
        jsonResponse(403, { error: { code: "forbidden", message: "Your role (reader) does not allow this." } }),
      );

      await expect(
        runPublish(testDeps({ fetch: fetchImpl, configPath, cwd: skillDir }), {}),
      ).rejects.toThrow(/not allowed to publish — publishing needs the writer role or higher/);
    } finally {
      await rm(skillDir, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    }
  });
});

describe("runPublish: publishing many Skills from a directory (ticket 7)", () => {
  async function withRoot(build: (root: string) => Promise<void>, run: (root: string) => Promise<void>): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), "skillreg-test-"));
    try {
      await build(root);
      await run(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  function respondToPuts(names: readonly string[]): { fetch: typeof fetch; calls: ReturnType<typeof stubFetch>["calls"] } {
    return stubFetch((url, init) => {
      const match = names.find((name) => url === `https://registry.example/api/resources/skill/${name}`);
      if (match && init?.method === "PUT") {
        return jsonResponse(200, {
          skill: { ...fakePublished().skill, name: match, id: `id-${match}` },
          upload: { url: `https://storage.example/${match}.zip`, method: "PUT", headers: {}, expires_in_seconds: 60 },
        });
      }
      if (names.some((name) => url === `https://storage.example/${name}.zip`)) {
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected request to ${url}`);
    });
  }

  it("publishes only the Skill at the given path when it holds one itself, ignoring sibling directories", async () => {
    await withRoot(
      async (root) => {
        await writeSkillAt(root, ".", "code-review");
        await writeSkillAt(root, "sibling", "unrelated");
      },
      async (root) => {
        const configDir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
        try {
          const configPath = join(configDir, "config.json");
          await writeConfig(configPath, { registry: "https://registry.example", token: "writer-token" });
          const { fetch: fetchImpl, calls } = respondToPuts(["code-review"]);

          const result = asResult(await runPublish(testDeps({ fetch: fetchImpl, configPath, cwd: root }), {}));

          expect(result.name).toBe("code-review");
          expect(calls).toHaveLength(2);
        } finally {
          await rm(configDir, { recursive: true, force: true });
        }
      },
    );
  });

  it("discovers and publishes every Skill under a directory, reporting each outcome", async () => {
    await withRoot(
      async (root) => {
        await writeSkillAt(root, "apps/code-review", "code-review");
        await writeSkillAt(root, "apps/pdf-tools", "pdf-tools");
      },
      async (root) => {
        const configDir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
        try {
          const configPath = join(configDir, "config.json");
          await writeConfig(configPath, { registry: "https://registry.example", token: "writer-token" });
          const { fetch: fetchImpl } = respondToPuts(["code-review", "pdf-tools"]);

          const outcomes = asOutcomes(
            await runPublish(testDeps({ fetch: fetchImpl, configPath, cwd: root }), { yes: true }),
          );

          expect(outcomes.map((outcome) => [outcome.name, outcome.status]).sort()).toEqual([
            ["code-review", "published"],
            ["pdf-tools", "published"],
          ]);
        } finally {
          await rm(configDir, { recursive: true, force: true });
        }
      },
    );
  });

  it("does not descend into a directory once it holds a Skill of its own", async () => {
    await withRoot(
      async (root) => {
        await writeSkillAt(root, "code-review", "code-review");
        // A supporting directory inside the Skill that itself happens to hold a SKILL.md —
        // must not be discovered as a second Skill.
        await writeSkillAt(root, "code-review/examples/nested", "not-a-skill");
      },
      async (root) => {
        const configDir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
        try {
          const configPath = join(configDir, "config.json");
          await writeConfig(configPath, { registry: "https://registry.example", token: "writer-token" });
          const { fetch: fetchImpl } = respondToPuts(["code-review", "not-a-skill"]);

          const outcomes = asOutcomes(
            await runPublish(testDeps({ fetch: fetchImpl, configPath, cwd: root }), { yes: true }),
          );

          expect(outcomes.map((outcome) => outcome.name)).toEqual(["code-review"]);
        } finally {
          await rm(configDir, { recursive: true, force: true });
        }
      },
    );
  });

  it("finds a Skill exactly three levels below the given path", async () => {
    await withRoot(
      async (root) => {
        await writeSkillAt(root, "a/b/c", "at-limit");
      },
      async (root) => {
        const configDir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
        try {
          const configPath = join(configDir, "config.json");
          await writeConfig(configPath, { registry: "https://registry.example", token: "writer-token" });
          const { fetch: fetchImpl } = respondToPuts(["at-limit"]);

          const outcomes = asOutcomes(
            await runPublish(testDeps({ fetch: fetchImpl, configPath, cwd: root }), { yes: true }),
          );
          expect(outcomes.map((outcome) => outcome.name)).toEqual(["at-limit"]);
        } finally {
          await rm(configDir, { recursive: true, force: true });
        }
      },
    );
  });

  it("does not look past three levels below the given path", async () => {
    await withRoot(
      async (root) => {
        await writeSkillAt(root, "a/b/c/d", "past-limit");
      },
      async (root) => {
        const configDir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
        try {
          const configPath = join(configDir, "config.json");
          await writeConfig(configPath, { registry: "https://registry.example", token: "writer-token" });
          const { fetch: fetchImpl, calls } = respondToPuts(["past-limit"]);

          await expect(
            runPublish(testDeps({ fetch: fetchImpl, configPath, cwd: root }), { yes: true }),
          ).rejects.toThrow(/No Skill found/);
          expect(calls).toHaveLength(0);
        } finally {
          await rm(configDir, { recursive: true, force: true });
        }
      },
    );
  });

  it("skips version-control metadata, dependency directories, and dotfile directories", async () => {
    await withRoot(
      async (root) => {
        await writeSkillAt(root, ".git", "dot-git");
        await writeSkillAt(root, "node_modules/left-pad", "left-pad");
        await writeSkillAt(root, "skills/code-review", "code-review");
      },
      async (root) => {
        const configDir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
        try {
          const configPath = join(configDir, "config.json");
          await writeConfig(configPath, { registry: "https://registry.example", token: "writer-token" });
          const { fetch: fetchImpl } = respondToPuts(["code-review"]);

          const outcomes = asOutcomes(
            await runPublish(testDeps({ fetch: fetchImpl, configPath, cwd: root }), { yes: true }),
          );
          expect(outcomes.map((outcome) => outcome.name)).toEqual(["code-review"]);
        } finally {
          await rm(configDir, { recursive: true, force: true });
        }
      },
    );
  });

  it("validates every Skill before publishing any — a single bad one aborts the batch, and nothing is published", async () => {
    await withRoot(
      async (root) => {
        await writeSkillAt(root, "apps/code-review", "code-review");
        await mkdir(join(root, "apps", "broken"), { recursive: true });
        await writeFile(join(root, "apps", "broken", "SKILL.md"), "no frontmatter here");
      },
      async (root) => {
        const configDir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
        try {
          const configPath = join(configDir, "config.json");
          await writeConfig(configPath, { registry: "https://registry.example", token: "writer-token" });
          const { fetch: fetchImpl, calls } = respondToPuts(["code-review"]);

          await expect(
            runPublish(testDeps({ fetch: fetchImpl, configPath, cwd: root }), { yes: true }),
          ).rejects.toThrow(/broken.*frontmatter_missing/s);
          expect(calls).toHaveLength(0);
        } finally {
          await rm(configDir, { recursive: true, force: true });
        }
      },
    );
  });

  it("reports a publish failure for one Skill without stopping the rest", async () => {
    await withRoot(
      async (root) => {
        await writeSkillAt(root, "apps/code-review", "code-review");
        await writeSkillAt(root, "apps/pdf-tools", "pdf-tools");
      },
      async (root) => {
        const configDir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
        try {
          const configPath = join(configDir, "config.json");
          await writeConfig(configPath, { registry: "https://registry.example", token: "writer-token" });
          const { fetch: fetchImpl } = stubFetch((url, init) => {
            if (url === "https://registry.example/api/resources/skill/code-review") {
              return jsonResponse(403, { error: { code: "forbidden", message: "nope" } });
            }
            if (url === "https://registry.example/api/resources/skill/pdf-tools" && init?.method === "PUT") {
              return jsonResponse(200, {
                skill: { ...fakePublished().skill, name: "pdf-tools", id: "id-pdf-tools" },
                upload: { url: "https://storage.example/pdf-tools.zip", method: "PUT", headers: {}, expires_in_seconds: 60 },
              });
            }
            if (url === "https://storage.example/pdf-tools.zip") return new Response(null, { status: 200 });
            throw new Error(`Unexpected request to ${url}`);
          });

          const outcomes = asOutcomes(
            await runPublish(testDeps({ fetch: fetchImpl, configPath, cwd: root }), { yes: true }),
          );

          expect(outcomes).toContainEqual(
            expect.objectContaining({ name: "code-review", status: "failed" }),
          );
          expect(outcomes).toContainEqual(
            expect.objectContaining({ name: "pdf-tools", status: "published", id: "id-pdf-tools" }),
          );
        } finally {
          await rm(configDir, { recursive: true, force: true });
        }
      },
    );
  });

  describe("confirming a publish of more than one Skill", () => {
    async function twoSkillRoot(build: (root: string) => Promise<void>): Promise<string> {
      const root = await mkdtemp(join(tmpdir(), "skillreg-test-"));
      await build(root);
      return root;
    }

    it("asks for confirmation, naming the Skills, before publishing more than one", async () => {
      const root = await twoSkillRoot(async (r) => {
        await writeSkillAt(r, "apps/code-review", "code-review");
        await writeSkillAt(r, "apps/pdf-tools", "pdf-tools");
      });
      const configDir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
      try {
        const configPath = join(configDir, "config.json");
        await writeConfig(configPath, { registry: "https://registry.example", token: "writer-token" });
        const { fetch: fetchImpl } = respondToPuts(["code-review", "pdf-tools"]);

        let askedNames: readonly string[] | undefined;
        await runPublish(
          testDeps({
            fetch: fetchImpl,
            configPath,
            cwd: root,
            confirm: async (names) => {
              askedNames = names;
              return true;
            },
          }),
          {},
        );

        expect(new Set(askedNames)).toEqual(new Set(["code-review", "pdf-tools"]));
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });

    it("does not ask when exactly one Skill is discovered", async () => {
      const root = await twoSkillRoot(async (r) => {
        await writeSkillAt(r, "apps/code-review", "code-review");
      });
      const configDir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
      try {
        const configPath = join(configDir, "config.json");
        await writeConfig(configPath, { registry: "https://registry.example", token: "writer-token" });
        const { fetch: fetchImpl } = respondToPuts(["code-review"]);

        let asked = false;
        await runPublish(
          testDeps({
            fetch: fetchImpl,
            configPath,
            cwd: root,
            confirm: async () => {
              asked = true;
              return true;
            },
          }),
          {},
        );

        expect(asked).toBe(false);
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });

    it("publishes nothing when the User declines", async () => {
      const root = await twoSkillRoot(async (r) => {
        await writeSkillAt(r, "apps/code-review", "code-review");
        await writeSkillAt(r, "apps/pdf-tools", "pdf-tools");
      });
      const configDir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
      try {
        const configPath = join(configDir, "config.json");
        await writeConfig(configPath, { registry: "https://registry.example", token: "writer-token" });
        const { fetch: fetchImpl, calls } = respondToPuts(["code-review", "pdf-tools"]);

        await expect(
          runPublish(testDeps({ fetch: fetchImpl, configPath, cwd: root, confirm: async () => false }), {}),
        ).rejects.toThrow(/Cancelled/);
        expect(calls).toHaveLength(0);
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });

    it("skips confirmation when --yes is passed", async () => {
      const root = await twoSkillRoot(async (r) => {
        await writeSkillAt(r, "apps/code-review", "code-review");
        await writeSkillAt(r, "apps/pdf-tools", "pdf-tools");
      });
      const configDir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
      try {
        const configPath = join(configDir, "config.json");
        await writeConfig(configPath, { registry: "https://registry.example", token: "writer-token" });
        const { fetch: fetchImpl } = respondToPuts(["code-review", "pdf-tools"]);

        let asked = false;
        const outcomes = asOutcomes(
          await runPublish(
            testDeps({
              fetch: fetchImpl,
              configPath,
              cwd: root,
              confirm: async () => {
                asked = true;
                return true;
              },
            }),
            { yes: true },
          ),
        );

        expect(asked).toBe(false);
        expect(outcomes).toHaveLength(2);
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });

    it("needs --yes rather than a prompt when no terminal is attached", async () => {
      const root = await twoSkillRoot(async (r) => {
        await writeSkillAt(r, "apps/code-review", "code-review");
        await writeSkillAt(r, "apps/pdf-tools", "pdf-tools");
      });
      const configDir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
      try {
        const configPath = join(configDir, "config.json");
        await writeConfig(configPath, { registry: "https://registry.example", token: "writer-token" });
        const { fetch: fetchImpl, calls } = respondToPuts(["code-review", "pdf-tools"]);

        await expect(
          runPublish(testDeps({ fetch: fetchImpl, configPath, cwd: root, isTTY: false }), {}),
        ).rejects.toThrow(/--yes/);
        expect(calls).toHaveLength(0);
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });

    it("checks the writer is logged in before asking for confirmation", async () => {
      const root = await twoSkillRoot(async (r) => {
        await writeSkillAt(r, "apps/code-review", "code-review");
        await writeSkillAt(r, "apps/pdf-tools", "pdf-tools");
      });
      const configDir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
      try {
        const configPath = join(configDir, "config.json");
        // No config written: not logged in.
        let asked = false;

        await expect(
          runPublish(
            testDeps({
              fetch: stubFetch(() => jsonResponse(200, {})).fetch,
              configPath,
              cwd: root,
              confirm: async () => {
                asked = true;
                return true;
              },
            }),
            {},
          ),
        ).rejects.toThrow(/Not logged in/);
        expect(asked).toBe(false);
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  });
});
