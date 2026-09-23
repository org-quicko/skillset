import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import pkg from "../package.json" with { type: "json" };
import { createServer } from "./server.js";

/** Where `docs/mcp.json` lives, relative to this package — what the Registry serves at `GET /mcp`. */
export const DISCOVERY_PATH = new URL("../../../docs/mcp.json", import.meta.url);

/** The discovery document `GET /mcp` serves: how to run this server, and what it offers. */
export interface DiscoveryDocument {
  name: string;
  title: string;
  description: string;
  /** The server's own instructions to a client, exactly as `initialize` returns them. */
  instructions: string;
  distribution: {
    npx: { package: string; command: string };
    mcpb: { description: string; url: string };
  };
  transport: "stdio";
  remote: false;
  /** Every tool, exactly as `tools/list` returns it — descriptions, annotations, and schemas included. */
  tools: Tool[];
}

const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/**
 * Builds the discovery document by asking the real server what it offers.
 *
 * @returns The document, with the server's name, title, instructions, and
 * every tool read over an in-memory MCP connection rather than written by
 * hand.
 * @throws Error if the server cannot be constructed or connected to — a bug
 * in the server, since nothing here touches the network or the filesystem.
 *
 * @remarks
 * The SDK has no way to describe a server without connecting to it, so this
 * connects a `Client` through `InMemoryTransport` and makes the same
 * `initialize` and `tools/list` calls an Agent makes. What comes back is
 * therefore what an Agent sees, and cannot drift from `server.ts` the way a
 * hand-kept copy did.
 *
 * The configuration is a placeholder: no tool is called, so the Registry URL
 * is never contacted, and every tool is registered whatever the
 * configuration says. The distribution details are the only part not read
 * from the server, since they describe how it is shipped rather than what
 * it does.
 *
 * @example
 * ```ts
 * const document = await buildDiscoveryDocument();
 * document.tools.map((tool) => tool.name); // ["search_skills", "install_skills", ...]
 * ```
 */
export async function buildDiscoveryDocument(): Promise<DiscoveryDocument> {
  const server = createServer(
    { registry: "https://registry.invalid", scope: "project", agentId: undefined, logLevel: "error", token: undefined, tokenSource: "none" },
    fetch,
    silent,
    { cwd: process.cwd(), env: {}, homeDir: process.cwd() },
  );
  const client = new Client({ name: "skillset-discovery", version: pkg.version });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : {});
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);

    const info = client.getServerVersion();
    return {
      name: info?.name ?? "skillset-mcp",
      title: info?.title ?? info?.name ?? "skillset-mcp",
      description: pkg.description,
      instructions: client.getInstructions() ?? "",
      distribution: {
        npx: { package: pkg.name, command: `npx ${pkg.name}` },
        mcpb: {
          description: "A single-file bundle for a host that installs an MCP server that way, e.g. Claude Desktop.",
          url: "/mcp.mcpb",
        },
      },
      transport: "stdio",
      remote: false,
      tools,
    };
  } finally {
    await client.close();
    await server.close();
  }
}

/** The document as `docs/mcp.json` stores it: two-space JSON with a trailing newline, so a rewrite diffs cleanly. */
export function formatDiscoveryDocument(document: DiscoveryDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
