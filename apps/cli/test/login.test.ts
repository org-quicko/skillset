import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLogin } from "../src/commands/login.js";
import { jsonResponse, stubFetch } from "./helpers.js";

function fakeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-1",
    email: "writer@example.com",
    first_name: "A",
    last_name: "B",
    role: "writer",
    must_change_password: false,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("runLogin", () => {
  it("stores the config and returns the resolved identity on a valid token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
    try {
      const configPath = join(dir, "config.json");
      const { fetch: fetchImpl, calls } = stubFetch((url) => {
        expect(url).toBe("https://registry.example/api/users/me");
        return jsonResponse(200, fakeUser());
      });

      const result = await runLogin(
        { fetch: fetchImpl, configPath },
        { registry: "https://registry.example", token: "secret-token" },
      );

      expect(result).toEqual({ registry: "https://registry.example", email: "writer@example.com", role: "writer" });
      expect(calls[0]?.init?.headers).toMatchObject({ authorization: "Bearer secret-token" });
      expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
        registry: "https://registry.example",
        token: "secret-token",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a bad token without writing the config file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
    try {
      const configPath = join(dir, "config.json");
      const { fetch: fetchImpl } = stubFetch(() =>
        jsonResponse(401, { error: { code: "unauthenticated", message: "No credential." } }),
      );

      await expect(
        runLogin({ fetch: fetchImpl, configPath }, { registry: "https://registry.example", token: "bad" }),
      ).rejects.toThrow(/Token rejected/);

      expect(await readFile(configPath, "utf8").catch(() => null)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("surfaces an unreachable registry distinctly from a rejected token", async () => {
    const fetchImpl = (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;

    await expect(
      runLogin({ fetch: fetchImpl, configPath: join(tmpdir(), "unused-skillreg-config.json") }, {
        registry: "https://nope.example",
        token: "x",
      }),
    ).rejects.toThrow(/Could not reach/);
  });
});
