#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { homedir } from "node:os";
import { ConfigError, parseConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  let config;
  try {
    config = parseConfig(process.argv.slice(2), process.env);
  } catch (error) {
    // Never console.log: stdout is the JSON-RPC stream, and no client is
    // connected yet for a stderr diagnostic to reach either — this is a
    // startup refusal, not a logged event.
    process.stderr.write(`${error instanceof ConfigError ? error.message : String(error)}\n`);
    process.exit(1);
  }

  const logger = createLogger(config.logLevel);
  // Warned about rather than refused: an existing `.mcp.json` using the flag
  // must keep working, and the person who can move the secret is the one
  // reading this server's stderr (ISSUE-22).
  if (config.tokenSource === "flag") {
    logger.warn(
      "--token puts the Token in this machine's process list and in the .mcp.json that configures this server, " +
        "which is usually checked in. Set SQILLSET_TOKEN in the environment instead.",
    );
  }

  const ctx = { cwd: process.cwd(), env: process.env, homeDir: homedir() };
  const server = createServer(config, fetch, logger, ctx);
  await server.connect(new StdioServerTransport());
  logger.info(
    `sqillset-mcp connected, registry=${config.registry} scope=${config.scope} agent-override=${config.agentId ?? "none (detected)"} ` +
      `token=${config.token ? "configured" : "none (publish_skill will refuse)"}`,
  );
}

await main();
