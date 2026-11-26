import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import type { Logger } from "../src/logger.js";
import { jsonResponse, stubFetch } from "./helpers.js";

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("Skillset MCP server instructions", () => {
  it("tells the client the Registry is remote and unlisted, so it searches instead of using its own catalog", async () => {
    const server = createServer(
      { registry: "https://registry.example", scope: "project", agentId: undefined, logLevel: "warn", token: undefined, tokenSource: "none" },
      fetch,
      noopLogger,
      { cwd: process.cwd(), env: {}, homeDir: process.cwd() },
    );
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const instructions = client.getInstructions() ?? "";
      expect(instructions).toContain("search_skills");
      expect(instructions).toContain("built-in Skill catalog");
      expect(instructions).toMatch(/remote registry of AI resources: Skills, Plugins, and MCP Servers/);
      expect(instructions).toContain("install_plugin");
      expect(instructions).toContain("search_plugins");
      expect(instructions).toContain("search_mcp_servers");
      expect(instructions).toContain("install_mcp_server");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("distinguishes search_skills from the client's own Skill catalog in its description", async () => {
    const server = createServer(
      { registry: "https://registry.example", scope: "project", agentId: undefined, logLevel: "warn", token: undefined, tokenSource: "none" },
      fetch,
      noopLogger,
      { cwd: process.cwd(), env: {}, homeDir: process.cwd() },
    );
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const { tools } = await client.listTools();
      const search = tools.find((tool) => tool.name === "search_skills");
      expect(search?.description).toContain("REMOTE Skill Registry");
      expect(search?.description).toContain("built-in Skill catalog");
    } finally {
      await client.close();
      await server.close();
    }
  });
});

// The SDK's Client checks `structuredContent` against each tool's `outputSchema`, as hosts do,
// and every object schema refuses properties it does not declare. A field a handler returns
// but the schema leaves out fails the call there, which a test of the handler alone cannot see.
describe("search tools' results match their output schemas", () => {
  const entry = {
    id: "r1",
    kind: "skill",
    namespace: "registry.example",
    name: "code-review",
    description: "Reviews code.",
    published_by_name: "A B",
    updated_at: "2026-09-20T00:00:00.000Z",
    installs: 3,
    allowed_tools: null,
    source: "com.example.registry",
    tags: [{ id: "t1", name: "quality" }],
  };

  it.each(["search_skills", "search_plugins", "search_mcp_servers"])("%s", async (tool) => {
    const { fetch: fetchImpl } = stubFetch(() => jsonResponse(200, { items: [entry], page: 1, page_size: 10, total: 1 }));
    const server = createServer(
      { registry: "https://registry.example", scope: "project", agentId: undefined, logLevel: "warn", token: undefined, tokenSource: "none" },
      fetchImpl,
      noopLogger,
      { cwd: process.cwd(), env: {}, homeDir: process.cwd() },
    );
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      // A client checks a result only against a schema it has listed, as every host does first.
      await client.listTools();
      const result = await client.callTool({ name: tool, arguments: { query: "review" } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ total: 1, results: [{ name: "code-review", namespace: "registry.example" }] });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
