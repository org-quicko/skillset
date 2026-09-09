import { describe, expect, it } from "bun:test";
import { ConfigError, parseConfig } from "../src/config.js";

describe("parseConfig", () => {
  it("errors naming both --registry and SKILLSET_REGISTRY when neither is given", () => {
    expect(() => parseConfig([], {})).toThrow(ConfigError);
    try {
      parseConfig([], {});
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).toContain("--registry");
      expect((error as Error).message).toContain("SKILLSET_REGISTRY");
    }
  });

  it("falls back to SKILLSET_REGISTRY when --registry is absent", () => {
    const config = parseConfig([], { SKILLSET_REGISTRY: "https://registry.example" });
    expect(config.registry).toBe("https://registry.example");
  });

  it("prefers --registry when both are given", () => {
    const config = parseConfig(["--registry", "https://flag.example"], {
      SKILLSET_REGISTRY: "https://env.example",
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

  it("never reads SKILLSET_TOKEN — this server holds no credential", () => {
    let readToken = false;
    const env = new Proxy(
      { SKILLSET_REGISTRY: "https://registry.example" },
      {
        get(target, prop) {
          if (prop === "SKILLSET_TOKEN") readToken = true;
          return Reflect.get(target, prop);
        },
      },
    ) as NodeJS.ProcessEnv;

    parseConfig([], env);

    expect(readToken).toBe(false);
  });

  it("defines no --token flag: an unrecognized flag is simply ignored, not read as a credential", () => {
    const config = parseConfig(["--registry", "https://registry.example", "--token", "secret"], {});
    expect(config).not.toHaveProperty("token");
  });
});
