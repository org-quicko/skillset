import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig, resolveConfigPath, resolveCredentials, resolveRegistryAccess, writeConfig } from "../src/config.js";

describe("resolveConfigPath", () => {
  it("prefers SKILLREG_CONFIG_PATH over everything else", () => {
    expect(resolveConfigPath({ SKILLREG_CONFIG_PATH: "/custom/config.json", APPDATA: "C:\\AppData" })).toBe(
      "/custom/config.json",
    );
  });

  it("uses APPDATA on Windows", () => {
    expect(resolveConfigPath({ APPDATA: "C:\\Users\\dev\\AppData\\Roaming" })).toBe(
      join("C:\\Users\\dev\\AppData\\Roaming", "skillreg", "config.json"),
    );
  });

  it("uses XDG_CONFIG_HOME when set and APPDATA is absent", () => {
    expect(resolveConfigPath({ XDG_CONFIG_HOME: "/home/dev/.config-custom" })).toBe(
      join("/home/dev/.config-custom", "skillreg", "config.json"),
    );
  });

  it("falls back to HOME/.config", () => {
    expect(resolveConfigPath({ HOME: "/home/dev" })).toBe(join("/home/dev", ".config", "skillreg", "config.json"));
  });
});

describe("readConfig / writeConfig", () => {
  it("returns null when no file exists yet", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
    try {
      expect(await readConfig(join(dir, "config.json"))).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("round-trips a written config, creating parent directories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
    try {
      const configPath = join(dir, "nested", "config.json");
      await writeConfig(configPath, { registry: "https://registry.example", token: "secret" });
      expect(await readConfig(configPath)).toEqual({ registry: "https://registry.example", token: "secret" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws a clear error on invalid JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
    try {
      const configPath = join(dir, "config.json");
      await Bun.write(configPath, "not json");
      await expect(readConfig(configPath)).rejects.toThrow(/not valid JSON/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws a clear error when the file is missing a registry or token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skillreg-test-"));
    try {
      const configPath = join(dir, "config.json");
      await Bun.write(configPath, JSON.stringify({ registry: "https://registry.example" }));
      await expect(readConfig(configPath)).rejects.toThrow(/missing a registry or token/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveCredentials", () => {
  const fileConfig = { registry: "https://file.example", token: "file-token" };

  it("uses the file config when no env vars are set", () => {
    expect(resolveCredentials({}, fileConfig)).toEqual(fileConfig);
  });

  it("prefers the env Token over the file's", () => {
    expect(resolveCredentials({ SKILLREG_TOKEN: "env-token" }, fileConfig)).toEqual({
      registry: "https://file.example",
      token: "env-token",
    });
  });

  it("keeps the stored Token when the env names the Registry it was stored against", () => {
    expect(resolveCredentials({ SKILLREG_REGISTRY: "https://file.example/" }, fileConfig)).toEqual({
      registry: "https://file.example/",
      token: "file-token",
    });
  });

  it("never sends the stored Token to a different Registry", () => {
    expect(resolveCredentials({ SKILLREG_REGISTRY: "https://env.example" }, fileConfig)).toBeNull();
  });

  it("returns null when neither source has both pieces", () => {
    expect(resolveCredentials({}, null)).toBeNull();
    expect(resolveCredentials({ SKILLREG_REGISTRY: "https://env.example" }, null)).toBeNull();
  });
});

describe("resolveRegistryAccess", () => {
  it("needs only a Registry, since reads need no Token (ADR-0013)", () => {
    expect(resolveRegistryAccess({ SKILLREG_REGISTRY: "https://env.example" }, null)).toEqual({
      registry: "https://env.example",
      token: undefined,
    });
  });

  it("still carries a Token when one is configured", () => {
    expect(resolveRegistryAccess({}, { registry: "https://file.example", token: "file-token" })).toEqual({
      registry: "https://file.example",
      token: "file-token",
    });
  });

  it("drops the stored Token when the env points at another Registry, rather than forwarding it", () => {
    expect(
      resolveRegistryAccess({ SKILLREG_REGISTRY: "https://other.example" }, {
        registry: "https://file.example",
        token: "file-token",
      }),
    ).toEqual({ registry: "https://other.example", token: undefined });
  });

  it("treats a trailing slash and a capitalised host as the same Registry", () => {
    expect(
      resolveRegistryAccess({ SKILLREG_REGISTRY: "https://File.Example/" }, {
        registry: "https://file.example",
        token: "file-token",
      }),
    ).toEqual({ registry: "https://File.Example/", token: "file-token" });
  });

  it("returns null only when no Registry is known at all", () => {
    expect(resolveRegistryAccess({}, null)).toBeNull();
    expect(resolveRegistryAccess({ SKILLREG_TOKEN: "orphan-token" }, null)).toBeNull();
  });
});
