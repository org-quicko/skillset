import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { installMcp, installPlugin, updatePlugins, type PluginToolDeps } from "../src/tools/plugins.js";
import { jsonResponse, stubFetch } from "./helpers.js";

const REGISTRY = "http://localhost:3000";
const encode = (text: string) => new TextEncoder().encode(text);

function plugin(agents: string[], updatedAt = "2026-11-01T00:00:00.000Z") {
  return {
    id: "8c0d6c1e-8f4b-4d8e-9a43-1c1f0f6e2a10",
    kind: "plugin",
    namespace: "localhost",
    name: "review-suite",
    description: "Reviews code.",
    body: null,
    agents,
    version: "1.0.0",
    license: null,
    homepage: null,
    components: null,
    source: "com.example.registry",
    published_at: updatedAt,
    updated_at: updatedAt,
    published_by: { user_id: "u1", email: "writer@example.com", first_name: "A", last_name: "B" },
    tags: [],
    installs: 0,
  };
}

const mcpServer = {
  id: "0b8a6f1e-1f4b-4d8e-9a43-1c1f0f6e2a11",
  kind: "mcp",
  namespace: "localhost",
  name: "io.github.acme/search",
  description: "Searches.",
  body: null,
  version: "1.0.0",
  packages: [{ registry_name: "npm", name: "@acme/search-mcp", version: "1.0.0" }],
  remotes: null,
  source: "com.example.registry",
  published_at: "2026-11-01T00:00:00.000Z",
  updated_at: "2026-11-01T00:00:00.000Z",
  published_by: { user_id: "u1", email: "writer@example.com", first_name: "A", last_name: "B" },
  tags: [],
  installs: 0,
};

const ZIP = zipSync({
  ".claude-plugin/plugin.json": encode(JSON.stringify({ name: "review-suite" })),
  ".cursor-plugin/plugin.json": encode(JSON.stringify({ name: "review-suite" })),
  "commands/review.md": encode("Review."),
});

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "skillset-mcp-plugins-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function depsFor(serve: () => ReturnType<typeof plugin>) {
  const ran: string[] = [];
  const { fetch, calls } = stubFetch((url) => {
    if (url.startsWith(`${REGISTRY}/api/resources/plugin/by-name/review-suite`)) return jsonResponse(200, serve());
    if (url.startsWith(`${REGISTRY}/api/resources/mcp/by-name/`)) return jsonResponse(200, mcpServer);
    if (url.endsWith("/artifact?source=mcp")) return new Response(ZIP);
    return jsonResponse(404, { error: { code: "not_found", message: "No." } });
  });
  const deps: PluginToolDeps = {
    fetchImpl: fetch,
    registry: REGISTRY,
    ctx: { cwd: home, env: { SKILLSET_CONFIG_PATH: join(home, "config", "config.json") }, homeDir: home },
    run: async (command, args) => {
      ran.push([command, ...args].join(" "));
      return { code: 0, output: "" };
    },
  };
  return { deps, calls, ran };
}

const records = async () =>
  JSON.parse(await readFile(join(home, "config", "plugins.json"), "utf8")) as { plugins: Record<string, unknown>[] };

describe("installPlugin", () => {
  it("installs for the detected agent and records it where the CLI's `plugins update` reads", async () => {
    const { deps } = depsFor(() => plugin(["claude-code", "cursor"]));
    const result = await installPlugin(deps, { name: "review-suite" }, "cursor");

    expect(result).toMatchObject({ name: "review-suite", agent: "cursor", supported_agents: ["claude-code", "cursor"], via: null });
    expect(result.path).toBe(join(home, ".cursor", "plugins", "local", "review-suite"));
    expect((await records()).plugins).toEqual([expect.objectContaining({ name: "review-suite", agent: "cursor" })]);
  });

  it("prefers the agent asked for over the detected one", async () => {
    const { deps, ran } = depsFor(() => plugin(["claude-code", "cursor"]));
    const result = await installPlugin(deps, { name: "review-suite", agent: "claude-code" }, "cursor");

    expect(result).toMatchObject({ agent: "claude-code", via: "local" });
    expect(ran.at(-1)).toStartWith("claude plugin install review-suite@");
  });

  it("falls back to the only agent the Plugin supports when the detected one is not a Plugin agent", async () => {
    const { deps } = depsFor(() => plugin(["cursor"]));
    expect((await installPlugin(deps, { name: "review-suite" }, "windsurf")).agent).toBe("cursor");
  });

  it("refuses an agent the Plugin has no manifest for, naming the ones it has", async () => {
    const { deps } = depsFor(() => plugin(["cursor"]));
    await expect(installPlugin(deps, { name: "review-suite" }, "claude-code")).rejects.toThrow(
      /no Claude Code manifest\. It supports: cursor \(Cursor\)/,
    );
  });

  it("asks for `agent` when several are supported and none was detected", async () => {
    const { deps } = depsFor(() => plugin(["claude-code", "cursor"]));
    await expect(installPlugin(deps, { name: "review-suite" }, null)).rejects.toThrow(/Pass `agent`/);
  });

  it("names the Plugin when the Registry has none by that name", async () => {
    const { deps } = depsFor(() => plugin(["cursor"]));
    await expect(installPlugin(deps, { name: "missing" }, "cursor")).rejects.toThrow(/Plugin "missing" was not found/);
  });
});

describe("updatePlugins", () => {
  it("leaves a current Plugin alone and reinstalls one the Registry has republished", async () => {
    let served = plugin(["cursor"]);
    const { deps, calls } = depsFor(() => served);
    await installPlugin(deps, { name: "review-suite" }, "cursor");

    expect(await updatePlugins(deps, {})).toEqual([
      { name: "review-suite", namespace: "localhost", agent: "cursor", status: "current", revision: "1.0.0+1793491200" },
    ]);

    served = plugin(["cursor"], "2026-11-02T00:00:00.000Z");
    const downloads = calls.filter((call) => call.url.includes("/artifact")).length;
    const [outcome] = await updatePlugins(deps, {});

    expect(outcome).toMatchObject({ status: "updated", from: "1.0.0+1793491200", to: "1.0.0+1793577600" });
    expect(calls.filter((call) => call.url.includes("/artifact")).length).toBe(downloads + 1);
  });

  it("refuses a named Plugin Skillset never installed", async () => {
    const { deps } = depsFor(() => plugin(["cursor"]));
    await expect(updatePlugins(deps, { name: "review-suite" })).rejects.toThrow(/was not installed with Skillset/);
  });
});

describe("installMcp", () => {
  it("adds the MCP Server to this project's .mcp.json", async () => {
    const { deps } = depsFor(() => plugin(["cursor"]));
    const result = await installMcp(deps, { name: "io.github.acme/search" });

    expect(result.config_path).toBe(join(home, ".mcp.json"));
    expect(result.overwritten).toBe(false);
    const written = JSON.parse(await readFile(join(home, ".mcp.json"), "utf8")) as { mcpServers: Record<string, unknown> };
    expect(written.mcpServers[result.server_key]).toEqual(result.config);
  });

  it("refuses to replace a configured server unless forced", async () => {
    const { deps } = depsFor(() => plugin(["cursor"]));
    const { server_key } = await installMcp(deps, { name: "io.github.acme/search" });
    await writeFile(join(home, ".mcp.json"), JSON.stringify({ mcpServers: { [server_key]: { command: "old" } } }));

    await expect(installMcp(deps, { name: "io.github.acme/search" })).rejects.toThrow(/already configured/);
    expect((await installMcp(deps, { name: "io.github.acme/search", force: true })).overwritten).toBe(true);
  });
});
