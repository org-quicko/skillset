import { describe, expect, it } from "bun:test";
import { ConfigError, parseConfig } from "../src/config.js";

describe("parseConfig", () => {
  it("errors naming both --registry and SQILLSET_REGISTRY when neither is given", () => {
    expect(() => parseConfig([], {})).toThrow(ConfigError);
    try {
      parseConfig([], {});
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).toContain("--registry");
      expect((error as Error).message).toContain("SQILLSET_REGISTRY");
    }
  });

  it("falls back to SQILLSET_REGISTRY when --registry is absent", () => {
    const config = parseConfig([], { SQILLSET_REGISTRY: "https://registry.example" });
    expect(config.registry).toBe("https://registry.example");
  });

  it("prefers --registry when both are given", () => {
    const config = parseConfig(["--registry", "https://flag.example"], {
      SQILLSET_REGISTRY: "https://env.example",
    });
    expect(config.registry).toBe("https://flag.example");
  });

  it("defaults --scope to project when omitted", () => {
    const config = parseConfig(["--registry", "https://registry.example"], {});
    expect(config.scope).toBe("project");
  });

  it("parses an explicit --scope", () => {
    const config = parseConfig(["--registry", "https://registry.example", "--scope", "user"], {});
    expect(config.scope).toBe("user");
  });

  it("rejects a --scope outside project/user", () => {
    expect(() => parseConfig(["--registry", "https://registry.example", "--scope", "global"], {})).toThrow(ConfigError);
  });

  it("defaults --log-level to warn when omitted", () => {
    const config = parseConfig(["--registry", "https://registry.example"], {});
    expect(config.logLevel).toBe("warn");
  });

  it("parses an explicit --log-level", () => {
    const config = parseConfig(["--registry", "https://registry.example", "--log-level", "debug"], {});
    expect(config.logLevel).toBe("debug");
  });

  it("leaves agentId undefined when --agent is omitted — the Agent is detected, not required", () => {
    const config = parseConfig(["--registry", "https://registry.example"], {});
    expect(config.agentId).toBeUndefined();
  });

  it("parses an explicit --agent as the override", () => {
    const config = parseConfig(["--registry", "https://registry.example", "--agent", "windsurf"], {});
    expect(config.agentId).toBe("windsurf");
  });

  it("rejects an --agent naming no row in the table, listing the Agents that exist", () => {
    try {
      parseConfig(["--registry", "https://registry.example", "--agent", "not-a-real-agent"], {});
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).toContain("claude-code");
      expect((error as Error).message).toContain("windsurf");
    }
  });

  it("leaves token undefined when neither --token nor SQILLSET_TOKEN is given", () => {
    const config = parseConfig(["--registry", "https://registry.example"], {});
    expect(config.token).toBeUndefined();
  });

  it("falls back to SQILLSET_TOKEN when --token is absent", () => {
    const config = parseConfig(["--registry", "https://registry.example"], {
      SQILLSET_TOKEN: "env-token",
    });
    expect(config.token).toBe("env-token");
  });

  it("prefers --token when both are given", () => {
    const config = parseConfig(["--registry", "https://registry.example", "--token", "flag-token"], {
      SQILLSET_TOKEN: "env-token",
    });
    expect(config.token).toBe("flag-token");
  });
});
