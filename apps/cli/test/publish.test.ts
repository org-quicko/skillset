import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { runPublish } from "../src/commands/publish.js";
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

function fakePublished() {
  return {
    skill: {
      id: "skill-1",
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
  it("validates locally and makes no network call on a validation failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
    try {
      const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));
      await expect(
        runPublish({ fetch: fetchImpl, configPath: join(dir, "config.json"), env: {}, cwd: dir }, {}),
      ).rejects.toThrow(/skill_md_missing/);
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
        runPublish({ fetch: fetchImpl, configPath: join(skillDir, "config.json"), env: {}, cwd: skillDir }, {}),
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
        if (url === "https://registry.example/api/skills/code-review") {
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

      const result = await runPublish({ fetch: fetchImpl, configPath, env: {}, cwd: skillDir }, {});

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

  it("surfaces the server's permission message for a reader's Token", async () => {
    const skillDir = await makeSkillDir();
    const configDir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
    try {
      const configPath = join(configDir, "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "reader-token" });

      const { fetch: fetchImpl } = stubFetch(() =>
        jsonResponse(403, { error: { code: "forbidden", message: "Your role (reader) does not allow this." } }),
      );

      await expect(runPublish({ fetch: fetchImpl, configPath, env: {}, cwd: skillDir }, {})).rejects.toThrow(
        /Your role \(reader\) does not allow this\./,
      );
    } finally {
      await rm(skillDir, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    }
  });
});
