import { dirname, join } from "node:path";
import {
  CLAUDE_MARKETPLACE_PATH,
  McpSchema,
  PLUGIN_AGENT_IDS,
  PLUGIN_AGENTS,
  PluginSchema,
  type AgentId,
  type Plugin,
  type PluginAgent,
} from "@in-org-quicko/skillset-shared";
import {
  installMcpServer,
  installRegistryPlugin,
  PLUGIN_RECORDS_FILE,
  resolveConfigPath,
  updateRegistryPlugins,
  type InstallContext,
  type McpServerConfigEntry,
  type PluginRegistry,
  type PluginUpdateOutcome,
  type PluginVia,
  type RunCommand,
} from "@in-org-quicko/skillset-installer";
import { z } from "zod";

/** What the Plugin and MCP Server tools need: where the Registry is, where on disk to write, and how to run an agent's CLI. */
export interface PluginToolDeps {
  fetchImpl: typeof fetch;
  registry: string;
  ctx: InstallContext;
  run: RunCommand;
}

/** {@link installPlugin}'s result. */
export interface InstallPluginResult {
  name: string;
  namespace: string;
  agent: PluginAgent;
  supported_agents: PluginAgent[];
  via: PluginVia;
  path: string | null;
  commands: string[];
  next: string | null;
}

/** {@link installMcp}'s result. */
export interface InstallMcpServerResult {
  server_key: string;
  config_path: string;
  overwritten: boolean;
  config: McpServerConfigEntry;
}

function byNameUrl(registry: string, kind: "plugin" | "mcp", name: string, namespace: string | undefined): URL {
  const url = new URL(`/api/resources/${kind}/by-name/${encodeURIComponent(name)}`, registry);
  if (namespace) url.searchParams.set("namespace", namespace);
  return url;
}

async function fetchJson<T>(fetchImpl: typeof fetch, url: URL, schema: z.ZodType<T>, what: string): Promise<T> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`${what} was not found (status ${res.status}).`);
  return schema.parse(await res.json());
}

function pluginRegistry(deps: PluginToolDeps): PluginRegistry {
  return {
    registry: deps.registry,
    fetchPlugin: (name, namespace) =>
      fetchJson(deps.fetchImpl, byNameUrl(deps.registry, "plugin", name, namespace), PluginSchema, `Plugin "${name}"`),
    downloadArtifact: async (plugin) => {
      const res = await deps.fetchImpl(new URL(`/api/resources/${plugin.id}/artifact?source=mcp`, deps.registry));
      if (!res.ok) throw new Error(`Downloading the Artifact failed (status ${res.status}).`);
      return new Uint8Array(await res.arrayBuffer());
    },
    marketplaceName: async () => {
      const url = new URL(CLAUDE_MARKETPLACE_PATH, deps.registry);
      return (await fetchJson(deps.fetchImpl, url, z.object({ name: z.string() }), "The Registry's marketplace")).name;
    },
  };
}

/** Shared with the CLI, so `skillset plugins update` also updates what this server installed. */
function pluginContext(deps: PluginToolDeps) {
  return {
    homeDir: deps.ctx.homeDir,
    run: deps.run,
    recordsPath: join(dirname(resolveConfigPath(deps.ctx.env)), PLUGIN_RECORDS_FILE),
  };
}

function describeAgents(agents: readonly PluginAgent[]): string {
  return agents.map((agent) => `${agent} (${PLUGIN_AGENTS[agent].label})`).join(", ");
}

function asPluginAgent(agentId: AgentId | null): PluginAgent | undefined {
  return PLUGIN_AGENT_IDS.find((id) => id === agentId);
}

/**
 * Picks the agent to install a Plugin for: the one asked for, else the detected Agent, else
 * the only one the Plugin supports.
 */
function chooseAgent(plugin: Plugin, requested: PluginAgent | undefined, detected: AgentId | null): PluginAgent {
  const agent = requested ?? asPluginAgent(detected) ?? (plugin.agents.length === 1 ? plugin.agents[0] : undefined);
  if (agent === undefined) {
    throw new Error(`Pass \`agent\`: "${plugin.name}" supports ${describeAgents(plugin.agents)}.`);
  }
  if (!plugin.agents.includes(agent)) {
    throw new Error(
      `"${plugin.name}" has no ${PLUGIN_AGENTS[agent].label} manifest. It supports: ${describeAgents(plugin.agents)}. ` +
        "Pass `agent` to install it for one of those.",
    );
  }
  return agent;
}

/**
 * Installs a Plugin from the Registry for one coding agent.
 *
 * @remarks
 * Plugins install per User, not per project: Claude Code through `claude plugin install`,
 * Cursor into `~/.cursor/plugins/local/`, Codex through `codex plugin add`. The install is
 * recorded in the same file the CLI uses, so `update_plugins` and `skillset plugins update`
 * both see it.
 *
 * @param deps - The `fetch` implementation, Registry URL, filesystem context, and how to run an agent's CLI.
 * @param options - The Plugin's name, its Namespace when the bare name is ambiguous, and the agent to
 * install for. Without `agent`, the detected Agent is used when it is one Plugins support, else the
 * only agent the Plugin supports.
 * @param detected - The Agent this server detected, or `null`.
 * @returns The Plugin, the agent chosen, every agent it supports, and what the install did.
 * @throws Error when the Registry has no such Plugin, when no agent can be chosen or the chosen one
 * has no manifest in the Plugin, when the agent's CLI is missing or fails, or when the Artifact
 * fails inspection.
 * @example
 * ```ts
 * await installPlugin(deps, { name: "review-suite", agent: "cursor" }, null);
 * ```
 */
export async function installPlugin(
  deps: PluginToolDeps,
  options: { name: string; namespace?: string; agent?: PluginAgent },
  detected: AgentId | null,
): Promise<InstallPluginResult> {
  const source = pluginRegistry(deps);
  const plugin = await source.fetchPlugin(options.name, options.namespace);
  const agent = chooseAgent(plugin, options.agent, detected);
  const report = await installRegistryPlugin(pluginContext(deps), source, plugin, agent);
  return {
    name: plugin.name,
    namespace: plugin.namespace,
    agent,
    supported_agents: plugin.agents,
    via: report.via,
    path: report.path,
    commands: report.commands,
    next: report.next ?? null,
  };
}

/**
 * Updates Plugins Skillset installed from this Registry, through this server or the CLI.
 *
 * @param deps - As for {@link installPlugin}.
 * @param filter - Which Plugin, Namespace and agent to update, and whether to reinstall one that is current.
 * @returns One outcome per installed Plugin and agent considered.
 * @throws Error when `name` is given and no install of it was recorded.
 * @example
 * ```ts
 * await updatePlugins(deps, {});
 * ```
 */
export function updatePlugins(
  deps: PluginToolDeps,
  filter: { name?: string; namespace?: string; agent?: PluginAgent; force?: boolean },
): Promise<PluginUpdateOutcome[]> {
  return updateRegistryPlugins(pluginContext(deps), pluginRegistry(deps), filter);
}

/**
 * Adds an MCP Server from the Registry to this project's `.mcp.json` (ADR-0029).
 *
 * @remarks
 * Always project scope, whatever `--scope` the server runs with: `--scope` governs Skills only.
 *
 * @param deps - The `fetch` implementation, Registry URL, and project root.
 * @param options - The MCP Server's name, its Namespace when the bare name is ambiguous, and whether
 * to replace a server of the same key already configured.
 * @returns The key it was written under, the file, whether it replaced one, and the entry written.
 * @throws Error when the Registry has no such MCP Server, when `.mcp.json` is not a JSON object, or
 * when the key is already configured and `force` is not set.
 * @example
 * ```ts
 * await installMcp(deps, { name: "io.github.acme/search" });
 * ```
 */
export async function installMcp(
  deps: Pick<PluginToolDeps, "fetchImpl" | "registry" | "ctx">,
  options: { name: string; namespace?: string; force?: boolean },
): Promise<InstallMcpServerResult> {
  const url = byNameUrl(deps.registry, "mcp", options.name, options.namespace);
  const mcp = await fetchJson(deps.fetchImpl, url, McpSchema, `MCP Server "${options.name}"`);
  const report = await installMcpServer({ cwd: deps.ctx.cwd, mcp, force: options.force });
  return { server_key: report.serverKey, config_path: report.path, overwritten: report.overwritten, config: report.config };
}
