import { describe, expect, it } from "bun:test";
import { PublishMcpBodySchema, PublishParamsSchema } from "./resources.schemas.js";

describe("PublishParamsSchema", () => {
  it("accepts valid skill params", () => {
    const parsed = PublishParamsSchema.parse({ kind: "skill", name: "code-review" });
    expect(parsed).toEqual({ kind: "skill", name: "code-review" });
  });

  it("accepts valid mcp params with reverse-DNS name", () => {
    const parsed = PublishParamsSchema.parse({ kind: "mcp", name: "com.example/weather" });
    expect(parsed).toEqual({ kind: "mcp", name: "com.example/weather" });
  });

  it("rejects invalid skill name", () => {
    expect(() => PublishParamsSchema.parse({ kind: "skill", name: "Not_Valid" })).toThrow();
  });

  it("accepts any non-blank mcp name, and refuses a blank one", () => {
    expect(PublishParamsSchema.parse({ kind: "mcp", name: "weather" }).name).toBe("weather");
    expect(() => PublishParamsSchema.parse({ kind: "mcp", name: "  " })).toThrow();
  });

  it("rejects unknown kind", () => {
    expect(() => PublishParamsSchema.parse({ kind: "invalid-kind", name: "foo" })).toThrow(/Unknown Kind/);
  });
});

describe("PublishMcpBodySchema", () => {
  it("accepts valid package MCP body", () => {
    const parsed = PublishMcpBodySchema.parse({
      description: "Weather tools",
      packages: [{ registry_name: "npm", name: "mcp-weather" }],
    });
    expect(parsed.description).toBe("Weather tools");
    expect(parsed.packages?.length).toBe(1);
  });

  it("accepts valid remote MCP body", () => {
    const parsed = PublishMcpBodySchema.parse({
      description: "Remote SSE MCP",
      remotes: [{ transport_type: "sse", url: "https://mcp.example.com/sse" }],
    });
    expect(parsed.description).toBe("Remote SSE MCP");
    expect(parsed.remotes?.length).toBe(1);
  });

  it("rejects body without packages or remotes", () => {
    expect(() =>
      PublishMcpBodySchema.parse({
        description: "Empty MCP",
        packages: [],
        remotes: [],
      }),
    ).toThrow();
  });

  it("rejects description exceeding 100 characters", () => {
    expect(() =>
      PublishMcpBodySchema.parse({
        description: "a".repeat(101),
        packages: [{ registry_name: "npm", name: "mcp-test" }],
      }),
    ).toThrow();
  });
});
