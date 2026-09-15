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

/**
 * A Token carries its owner's full role, so `--registry http://...` handed a
 * writer's publish rights to anything on the path (ISSUE-22). Refused before
 * the request, because the point is that the Token is never sent over that
 * transport at all.
 */
describe("runLogin refuses to send a Token in the clear", () => {
  async function attempt(registry: string, insecure?: boolean) {
    const dir = await mkdtemp(join(tmpdir(), "sqillset-test-"));
    const configPath = join(dir, "config.json");
    const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, fakeUser()));
    try {
      const result = await runLogin({ fetch: fetchImpl, configPath }, { registry, token: "t", insecure }).then(
        () => "ok" as const,
        (error: Error) => error,
      );
      return { result, calls, configPath };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("refuses a plain-http Registry that is not on this machine, without contacting it", async () => {
    const { result, calls } = await attempt("http://registry.example");
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/in the clear/);
    expect(calls).toHaveLength(0);
  });

  it("allows plain http on loopback, where the bytes never reach a network", async () => {
    // The quick start's own `http://localhost:3000`.
    expect((await attempt("http://localhost:3000")).result).toBe("ok");
    expect((await attempt("http://127.0.0.1:3000")).result).toBe("ok");
  });

  it("allows a plain-http Registry when it is asked for out loud", async () => {
    expect((await attempt("http://registry.example", true)).result).toBe("ok");
  });

  it("refuses a URL it cannot parse rather than guessing at it", async () => {
    const { result } = await attempt("registry.example");
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/not a valid Registry URL/);
  });
});

describe("runLogin", () => {
  it("stores the config and returns the resolved identity on a valid token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sqillset-test-"));
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
    const dir = await mkdtemp(join(tmpdir(), "sqillset-test-"));
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
      runLogin({ fetch: fetchImpl, configPath: join(tmpdir(), "unused-sqillset-config.json") }, {
        registry: "https://nope.example",
        token: "x",
      }),
    ).rejects.toThrow(/Could not reach/);
  });
});
