import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import type { Logger } from "../src/logger.js";

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("Skillset MCP server instructions", () => {
  it("tells the client the Registry is remote and unlisted, so it searches instead of using its own catalog", async () => {
    const server = createServer(
      { registry: "https://registry.example", scope: "project", agentId: undefined, logLevel: "warn", token: undefined },
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
      expect(instructions).toMatch(/remote Skill Registry/i);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("distinguishes search_skills from the client's own Skill catalog in its description", async () => {
    const server = createServer(
      { registry: "https://registry.example", scope: "project", agentId: undefined, logLevel: "warn", token: undefined },
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
