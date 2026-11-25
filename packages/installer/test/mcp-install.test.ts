import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpDetail } from "@in-org-quicko/skillset-shared";
import {
  deriveMcpServerKey,
  installMcpServer,
  mcpResourceToConfig,
} from "../src/mcp-install.js";

const FAKE_MCP_NPM: McpDetail = {
  id: "01933c5c-7d90-7bb0-b772-df7592cfb37b",
  kind: "mcp",
  namespace: "quicko.com",
  name: "com.example/weather",
  description: "Weather MCP server",
  body: null,
  packages: [
    {
      registry_name: "npm",
      name: "@example/weather-server",
      version: "1.2.0",
      package_arguments: ["--city", "London"],
      environment_variables: [{ name: "API_KEY", default: "test_key" }],
    },
  ],
  remotes: null,
  source: "https://github.com/example/weather",
  published_at: "2026-11-20T10:00:00Z",
  updated_at: "2026-11-20T10:00:00Z",
  published_by: {
    user_id: "user-1",
    email: "dev@example.com",
    first_name: "Dev",
    last_name: "User",
  },
  tags: [],
  installs: 5,
};

const FAKE_MCP_REMOTE: McpDetail = {
  id: "01933c5c-7d90-7bb0-b772-df7592cfb37c",
  kind: "mcp",
  namespace: "quicko.com",
  name: "com.example/remote-tool",
  description: "Remote MCP server",
  body: null,
  packages: null,
  remotes: [
    {
      transport_type: "sse",
      url: "https://mcp.example.com/sse",
      headers: { Authorization: "Bearer xyz" },
    },
  ],
  source: "https://github.com/example/remote",
  published_at: "2026-11-20T10:00:00Z",
  updated_at: "2026-11-20T10:00:00Z",
  published_by: {
    user_id: "user-1",
    email: "dev@example.com",
    first_name: "Dev",
    last_name: "User",
  },
  tags: [],
  installs: 2,
};

describe("deriveMcpServerKey", () => {
  it("extracts short name after slash", () => {
    expect(deriveMcpServerKey("com.example/weather")).toBe("weather");
    expect(deriveMcpServerKey("io.github.acme/filesystem-mcp")).toBe("filesystem-mcp");
  });

  it("keeps name as is if no slash", () => {
    expect(deriveMcpServerKey("weather")).toBe("weather");
  });
});

describe("mcpResourceToConfig", () => {
  it("converts npm package to npx command", () => {
    const config = mcpResourceToConfig(FAKE_MCP_NPM);
    expect(config.command).toBe("npx");
    expect(config.args).toEqual(["-y", "@example/weather-server@1.2.0", "--city", "London"]);
    expect(config.env).toEqual({ API_KEY: "test_key" });
  });

  it("converts remote SSE to url config", () => {
    const config = mcpResourceToConfig(FAKE_MCP_REMOTE);
    expect(config.url).toBe("https://mcp.example.com/sse");
    expect(config.headers).toEqual({ Authorization: "Bearer xyz" });
  });
});

describe("installMcpServer", () => {
  it("creates a fresh .mcp.json if none exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-test-"));
    try {
      const report = await installMcpServer({ cwd: dir, mcp: FAKE_MCP_NPM });
      expect(report.serverKey).toBe("weather");
      expect(report.overwritten).toBe(false);

      const content = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf-8"));
      expect(content.mcpServers.weather.command).toBe("npx");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("merges into an existing .mcp.json without clobbering other servers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-test-"));
    try {
      const existing = {
        mcpServers: {
          existingServer: { command: "node", args: ["existing.js"] },
        },
      };
      await writeFile(join(dir, ".mcp.json"), JSON.stringify(existing, null, 2), "utf-8");

      const report = await installMcpServer({ cwd: dir, mcp: FAKE_MCP_REMOTE });
      expect(report.serverKey).toBe("remote-tool");

      const content = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf-8"));
      expect(content.mcpServers.existingServer.command).toBe("node");
      expect(content.mcpServers["remote-tool"].url).toBe("https://mcp.example.com/sse");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an existing entry without force", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-test-"));
    try {
      await installMcpServer({ cwd: dir, mcp: FAKE_MCP_NPM });
      expect(installMcpServer({ cwd: dir, mcp: FAKE_MCP_NPM })).rejects.toThrow(/already configured/);

      // Sockets with force: true
      const report = await installMcpServer({ cwd: dir, mcp: FAKE_MCP_NPM, force: true });
      expect(report.overwritten).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses unparseable JSON files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-test-"));
    try {
      await writeFile(join(dir, ".mcp.json"), "this is not json!", "utf-8");
      expect(installMcpServer({ cwd: dir, mcp: FAKE_MCP_NPM })).rejects.toThrow(/not valid JSON/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
