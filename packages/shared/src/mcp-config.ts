import type { McpDetail, McpPackage, McpRemote } from "./mcp.js";

/** One server's entry under `mcpServers` in `.mcp.json` (ADR-0029). */
export interface McpServerConfigEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

/**
 * Converts an MCP Server resource into an entry suitable for `.mcp.json`.
 */
export function mcpResourceToConfig(mcp: McpDetail): McpServerConfigEntry {
  if (mcp.packages && mcp.packages.length > 0 && mcp.packages[0]) {
    const pkg = mcp.packages[0];
    return mcpPackageToConfig(pkg);
  }

  if (mcp.remotes && mcp.remotes.length > 0 && mcp.remotes[0]) {
    const remote = mcp.remotes[0];
    return mcpRemoteToConfig(remote);
  }

  throw new Error(`MCP server "${mcp.name}" has neither packages nor remotes defined.`);
}

function mcpPackageToConfig(pkg: McpPackage): McpServerConfigEntry {
  const env: Record<string, string> = {};
  if (pkg.environment_variables) {
    for (const ev of pkg.environment_variables) {
      if (ev.default !== undefined) {
        env[ev.name] = ev.default;
      }
    }
  }

  const pkgArgs = pkg.package_arguments ?? [];

  switch (pkg.registry_name) {
    case "npm": {
      const pkgSpec = pkg.version ? `${pkg.name}@${pkg.version}` : pkg.name;
      return {
        command: "npx",
        args: ["-y", pkgSpec, ...pkgArgs],
        ...(Object.keys(env).length > 0 ? { env } : {}),
      };
    }
    case "pypi": {
      const pkgSpec = pkg.version ? `${pkg.name}==${pkg.version}` : pkg.name;
      return {
        command: "uvx",
        args: [pkgSpec, ...pkgArgs],
        ...(Object.keys(env).length > 0 ? { env } : {}),
      };
    }
    case "oci": {
      const tag = pkg.version ? `:${pkg.version}` : ":latest";
      return {
        command: "docker",
        args: ["run", "-i", "--rm", `${pkg.name}${tag}`, ...pkgArgs],
        ...(Object.keys(env).length > 0 ? { env } : {}),
      };
    }
    default: {
      return {
        command: pkg.name,
        args: pkgArgs,
        ...(Object.keys(env).length > 0 ? { env } : {}),
      };
    }
  }
}

function mcpRemoteToConfig(remote: McpRemote): McpServerConfigEntry {
  return {
    url: remote.url,
    ...(remote.headers ? { headers: remote.headers } : {}),
  };
}

/**
 * Derives a clean server key from reverse-DNS MCP name, e.g. `com.example/weather` -> `weather`.
 */
export function deriveMcpServerKey(name: string): string {
  const parts = name.split("/");
  const lastPart = parts[parts.length - 1];
  return lastPart || name;
}
