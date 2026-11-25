import { describe, expect, it } from "bun:test";
import {
  McpPayloadSchema,
  McpPublishSchema,
  McpValidationError,
  validateMcpDescription,
  validateMcpName,
} from "../src/index.js";

describe("validateMcpName", () => {
  it("accepts any non-blank name, reverse-DNS or not", () => {
    for (const name of ["com.example/weather", "weather", "My Weather Server", "a", "com.example/weather/v1"]) {
      expect(validateMcpName(name)).toBe(name);
    }
  });

  it("rejects a missing or blank name", () => {
    expect(() => validateMcpName("")).toThrow(McpValidationError);
    expect(() => validateMcpName("   ")).toThrow(McpValidationError);
    expect(() => validateMcpName(undefined)).toThrow(McpValidationError);
  });
});

describe("validateMcpDescription", () => {
  it("accepts valid descriptions within 100 characters", () => {
    expect(validateMcpDescription("Filesystem tools for AI")).toBe("Filesystem tools for AI");
  });

  it("rejects empty or whitespace-only descriptions", () => {
    expect(() => validateMcpDescription("")).toThrow(McpValidationError);
    expect(() => validateMcpDescription("   ")).toThrow(McpValidationError);
  });

  it("rejects descriptions longer than 100 characters", () => {
    const tooLong = "a".repeat(101);
    expect(() => validateMcpDescription(tooLong)).toThrow(McpValidationError);
  });
});

describe("McpPayloadSchema & McpPublishSchema", () => {
  it("validates package payloads", () => {
    const payload = {
      kind: "mcp" as const,
      packages: [
        {
          registry_name: "npm" as const,
          name: "@modelcontextprotocol/server-filesystem",
          version: "1.0.0",
          package_arguments: ["/workspace"],
          environment_variables: [{ name: "DEBUG", default: "false" }],
        },
      ],
    };
    expect(McpPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("validates remote payloads", () => {
    const payload = {
      kind: "mcp" as const,
      remotes: [
        {
          transport_type: "sse" as const,
          url: "https://mcp.quicko.com/sse",
          headers: { Authorization: "Bearer token" },
        },
      ],
    };
    expect(McpPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("validates publish schema", () => {
    const publish = {
      description: "Quicko MCP tools",
      remotes: [{ transport_type: "sse" as const, url: "https://example.com/sse" }],
    };
    expect(McpPublishSchema.safeParse(publish).success).toBe(true);
  });
});
