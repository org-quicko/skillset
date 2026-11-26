import { describe, expect, it } from "bun:test";
import type { McpDetail } from "@in-org-quicko/skillset-shared";
import { mcpClientSnippets, type McpClient } from "../src/lib/mcp-client-config";

const BASE: Omit<McpDetail, "packages" | "remotes"> = {
  id: "01933c5c-7d90-7bb0-b772-df7592cfb37b",
  kind: "mcp",
  namespace: "io.github.acme",
  name: "io.github.acme/weather",
  description: "Forecasts.",
  body: null,
  source: "https://github.com/acme/weather",
  published_at: "2026-11-20T10:00:00Z",
  updated_at: "2026-11-20T10:00:00Z",
  published_by: { user_id: "u1", email: "dev@example.com", first_name: "Dev", last_name: "User" },
  tags: [],
  installs: 0,
};

const PACKAGE: McpDetail = {
  ...BASE,
  packages: [
    {
      registry_name: "npm",
      name: "@acme/weather-mcp",
      version: "1.2.0",
      package_arguments: ["--units", "metric"],
      environment_variables: [{ name: "WEATHER_API_KEY", required: true }],
    },
  ],
  remotes: null,
};

const REMOTE: McpDetail = {
  ...BASE,
  packages: null,
  remotes: [{ transport_type: "sse", url: "https://mcp.acme.com/sse", headers: { Authorization: "Bearer x" } }],
};

function snippet(mcp: McpDetail, client: McpClient) {
  const found = mcpClientSnippets(mcp).find((s) => s.client === client);
  if (!found) throw new Error(`No ${client} snippet.`);
  return found;
}

describe("mcpClientSnippets", () => {
  it("offers .mcp.json, Claude Code, Codex and Cursor, in that order", () => {
    expect(mcpClientSnippets(PACKAGE).map((s) => s.label)).toEqual([".mcp.json", "Claude Code", "Codex", "Cursor"]);
  });

  it("gives Claude Code a command that passes env vars and runs the package after --", () => {
    expect(snippet(PACKAGE, "claude").code).toBe(
      "claude mcp add weather -e 'WEATHER_API_KEY=<YOUR_WEATHER_API_KEY>' -- npx -y @acme/weather-mcp@1.2.0 --units metric",
    );
  });

  it("gives Claude Code the remote's transport and headers", () => {
    expect(snippet(REMOTE, "claude").code).toBe(
      "claude mcp add --transport sse weather https://mcp.acme.com/sse --header 'Authorization: Bearer x'",
    );
  });

  it("gives Codex a config.toml table it can parse", () => {
    const toml = snippet(PACKAGE, "codex").code;
    const parsed = Bun.TOML.parse(toml) as {
      mcp_servers: { weather: { command: string; args: string[]; env: Record<string, string> } };
    };
    expect(parsed.mcp_servers.weather).toEqual({
      command: "npx",
      args: ["-y", "@acme/weather-mcp@1.2.0", "--units", "metric"],
      env: { WEATHER_API_KEY: "<YOUR_WEATHER_API_KEY>" },
    });
  });

  it("gives Codex a remote's URL and headers, and warns that it does not speak SSE", () => {
    const codex = snippet(REMOTE, "codex");
    const parsed = Bun.TOML.parse(codex.code) as {
      mcp_servers: { weather: { url: string; http_headers: Record<string, string> } };
    };
    expect(parsed.mcp_servers.weather).toEqual({
      url: "https://mcp.acme.com/sse",
      http_headers: { Authorization: "Bearer x" },
    });
    expect(codex.note).toBeDefined();
  });

  it("tells Claude Code's .mcp.json a remote's transport, and leaves Cursor's entry without it", () => {
    const mcpJson = JSON.parse(snippet(REMOTE, "mcp-json").code);
    const cursor = JSON.parse(snippet(REMOTE, "cursor").code);
    expect(mcpJson.mcpServers.weather.type).toBe("sse");
    expect(cursor.mcpServers.weather).toEqual({
      url: "https://mcp.acme.com/sse",
      headers: { Authorization: "Bearer x" },
    });
  });
});
