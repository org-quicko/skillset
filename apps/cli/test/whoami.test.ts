import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWhoami } from "../src/commands/whoami.js";
import { writeConfig } from "../src/config.js";
import { jsonResponse, stubFetch } from "./helpers.js";

function fakeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-1",
    email: "reader@example.com",
    first_name: "A",
    last_name: "B",
    role: "reader",
    must_change_password: false,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("runWhoami", () => {
  it("reports the resolved identity when authenticated via the config file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skillset-test-"));
    try {
      const configPath = join(dir, "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "secret" });

      const { fetch: fetchImpl } = stubFetch(() => jsonResponse(200, fakeUser()));

      const result = await runWhoami({ fetch: fetchImpl, configPath, env: {} });
      expect(result).toEqual({ registry: "https://registry.example", email: "reader@example.com", role: "reader" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("prefers env credentials over the config file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skillset-test-"));
    try {
      const configPath = join(dir, "config.json");
      await writeConfig(configPath, { registry: "https://file.example", token: "file-token" });

      const { fetch: fetchImpl, calls } = stubFetch(() =>
        jsonResponse(200, fakeUser({ email: "ci@example.com", role: "writer" })),
      );

      const result = await runWhoami({
        fetch: fetchImpl,
        configPath,
        env: { SKILLSET_REGISTRY: "https://env.example", SKILLSET_TOKEN: "env-token" },
      });

      expect(result).toEqual({ registry: "https://env.example", email: "ci@example.com", role: "writer" });
      expect(calls[0]?.url).toBe("https://env.example/api/users/me");
      expect(calls[0]?.init?.headers).toMatchObject({ authorization: "Bearer env-token" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("errors clearly when not logged in, with no request made", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skillset-test-"));
    try {
      const configPath = join(dir, "config.json");
      const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, fakeUser()));
      await expect(runWhoami({ fetch: fetchImpl, configPath, env: {} })).rejects.toThrow(/Not logged in/);
      expect(calls).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
