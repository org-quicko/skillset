import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  deriveMcpServerKey,
  mcpResourceToConfig,
  type McpDetail,
  type McpServerConfigEntry,
} from "@in-org-quicko/skillset-shared";

// Re-exported so existing importers of the installer keep working; the mapping lives in shared so the web shows the same config.
export { deriveMcpServerKey, mcpResourceToConfig, type McpServerConfigEntry };

export interface McpInstallReport {
  path: string;
  serverKey: string;
  config: McpServerConfigEntry;
  overwritten: boolean;
}

export interface InstallMcpOptions {
  cwd: string;
  mcp: McpDetail;
  serverKey?: string;
  force?: boolean;
}

/**
 * Installs or merges an MCP server configuration into `<cwd>/.mcp.json` (ADR-0029).
 */
export async function installMcpServer(options: InstallMcpOptions): Promise<McpInstallReport> {
  const configPath = join(options.cwd, ".mcp.json");
  const serverKey = options.serverKey ?? deriveMcpServerKey(options.mcp.name);
  const serverConfig = mcpResourceToConfig(options.mcp);

  let root: Record<string, unknown> = {};
  let fileExisted = false;

  try {
    const raw = await readFile(configPath, "utf-8");
    fileExisted = true;
    try {
      root = JSON.parse(raw);
    } catch {
      throw new Error(
        `Existing configuration at ${configPath} is not valid JSON. Refusing to overwrite. Please fix the file and try again.`,
      );
    }
  } catch (err: unknown) {
    if (fileExisted) throw err;
    // File did not exist; initialize a new object
    root = {};
  }

  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    throw new Error(`Expected an object in ${configPath}, but found ${Array.isArray(root) ? "array" : typeof root}.`);
  }

  let mcpServers = root.mcpServers as Record<string, unknown> | undefined;
  if (!mcpServers || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    mcpServers = {};
    root.mcpServers = mcpServers;
  }

  const alreadyExists = Object.hasOwn(mcpServers, serverKey);
  if (alreadyExists && !options.force) {
    throw new Error(
      `MCP server "${serverKey}" is already configured in ${configPath}. Use --force to replace it.`,
    );
  }

  mcpServers[serverKey] = serverConfig;

  await writeFile(configPath, JSON.stringify(root, null, 2) + "\n", "utf-8");

  return {
    path: configPath,
    serverKey,
    config: serverConfig,
    overwritten: alreadyExists,
  };
}
