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

describe("Skillset MCP prompt", () => {
  it("exposes /skillset with instructions to search and add Skills", async () => {
    const server = createServer(
      { registry: "https://registry.example", scope: "project", agentId: undefined, logLevel: "warn" },
      fetch,
      noopLogger,
      { cwd: process.cwd(), env: {}, homeDir: process.cwd() },
    );
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const { prompts } = await client.listPrompts();
      expect(prompts).toContainEqual(
        expect.objectContaining({
          name: "skillset",
          title: "Use Skillset",
        }),
      );

      const prompt = await client.getPrompt({ name: "skillset" });
      const text = prompt.messages[0]?.content.type === "text" ? prompt.messages[0].content.text : "";
      expect(text).toContain("Explicitly use the Skillset MCP");
      expect(text).toContain("search_skills");
      expect(text).toContain("add_skills");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
