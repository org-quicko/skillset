import { dirname, join } from "node:path";
import {
  CLAUDE_MARKETPLACE_PATH,
  PLUGIN_AGENT_IDS,
  PLUGIN_AGENTS,
  PluginSchema,
  type Plugin,
  type PluginAgent,
} from "@in-org-quicko/skillset-shared";
import {
  installRegistryPlugin,
  PLUGIN_RECORDS_FILE,
  updateRegistryPlugins,
  type PluginInstallReport,
  type PluginRegistry,
  type PluginUpdateOutcome,
  type PluginVia,
  type RegistryPluginContext,
  type RunCommand,
} from "@in-org-quicko/skillset-installer";
import { z } from "zod";
import { downloadBinary, registryFetch, RegistryUnreachableError, type RegistryClient } from "../http.js";
import { openReadClient, type SessionDeps } from "../session.js";

export { servesHostedMarketplace, type PluginUpdateOutcome } from "@in-org-quicko/skillset-installer";

export interface PluginInstallDeps extends SessionDeps {
  homeDir: string;
  /** Whether a terminal is attached — decides whether a missing `--agent` can be prompted for. */
  isTTY: boolean;
  /** Asks the User to choose one of `choices`. Called only when `isTTY` is true and `--agent` was omitted. */
  promptChoice(question: string, choices: readonly string[]): Promise<string>;
  /** Runs an agent's own CLI (`claude`, `codex`). */
  run: RunCommand;
}

export interface PluginInstallOptions {
  /** The Plugin's name at the Registry. */
  name: string;
  /** Which party named it, when a bare name matches more than one (ADR-0042). */
  namespace?: string;
  /** `--agent`: which agent to install it for — one the Plugin has a manifest for. */
  agent?: string;
}

/** What `skillset plugins install` did, and every agent the Plugin could have been installed for. */
export interface PluginInstallResult extends PluginInstallReport {
  name: string;
  namespace: string;
  supported_agents: PluginAgent[];
  /** How Claude Code got it: from the Registry's hosted marketplace, or a local copy. `null` for other agents. */
  via: PluginVia;
}

/** Install records live beside the CLI's config, so the MCP server's installs are updated here too. */
function pluginContext(deps: PluginInstallDeps): RegistryPluginContext {
  return { homeDir: deps.homeDir, run: deps.run, recordsPath: join(dirname(deps.configPath), PLUGIN_RECORDS_FILE) };
}

async function fetchPlugin(client: RegistryClient, name: string, namespace: string | undefined): Promise<Plugin> {
  const query = namespace ? `?namespace=${encodeURIComponent(namespace)}` : "";
  return registryFetch(client, `/resources/plugin/by-name/${encodeURIComponent(name)}${query}`, PluginSchema);
}

/** The `name` the Registry's hosted Claude Code marketplace goes by, which an Admin can change. */
async function hostedMarketplaceName(client: RegistryClient): Promise<string> {
  const url = new URL(CLAUDE_MARKETPLACE_PATH, client.registry);
  let res: Response;
  try {
    res = await client.fetch(url);
  } catch (error) {
    throw new RegistryUnreachableError(client.registry, error);
  }
  if (!res.ok) throw new Error(`Could not read the Registry's marketplace at ${url.href} (HTTP ${res.status}).`);
  return z.object({ name: z.string() }).parse(await res.json()).name;
}

function pluginRegistry(client: RegistryClient): PluginRegistry {
  return {
    registry: client.registry,
    fetchPlugin: (name, namespace) => fetchPlugin(client, name, namespace),
    downloadArtifact: (plugin) => downloadBinary(client, `/resources/${plugin.id}/artifact?source=cli`),
    marketplaceName: () => hostedMarketplaceName(client),
  };
}

/** Every agent's id, followed by its label, for an error or a prompt. */
function describeAgents(agents: readonly PluginAgent[]): string {
  return agents.map((agent) => `${agent} (${PLUGIN_AGENTS[agent].label})`).join(", ");
}

function parseAgent(flag: string): PluginAgent {
  const agent = PLUGIN_AGENT_IDS.find((id) => id === flag);
  if (!agent) throw new Error(`Unknown agent "${flag}" — choose from: ${describeAgents(PLUGIN_AGENT_IDS)}.`);
  return agent;
}

/** The agent to install for: `--agent`, the only one the Plugin supports, or the User's pick. */
async function chooseAgent(
  deps: PluginInstallDeps,
  supported: readonly PluginAgent[],
  flag: string | undefined,
): Promise<PluginAgent> {
  if (flag !== undefined) {
    const agent = parseAgent(flag);
    if (!supported.includes(agent)) {
      throw new Error(
        `This Plugin has no ${PLUGIN_AGENTS[agent].label} manifest. It supports: ${describeAgents(supported)}.`,
      );
    }
    return agent;
  }
  const [only] = supported;
  if (supported.length === 1 && only) return only;
  if (!deps.isTTY) throw new Error(`Pass --agent: this Plugin supports ${describeAgents(supported)}.`);
  const picked = await deps.promptChoice("Install for which agent?", supported);
  return chooseAgent(deps, supported, picked);
}

/**
 * Installs a Plugin from the Registry for one of the agents it supports.
 *
 * @remarks
 * The agents a Plugin supports are the agent manifests it holds
 * (`.claude-plugin/`, `.cursor-plugin/`, `.codex-plugin/`); it is never
 * installed for an agent it has no manifest for. Each agent installs its own
 * way, as the JFrog CLI does:
 *
 * - Claude Code adds the Registry's hosted `/.claude-plugin/marketplace.json`
 *   and runs `claude plugin install` when the Registry is public HTTPS; when it
 *   is not, which Claude Code refuses, the CLI writes a local marketplace instead.
 * - Cursor gets the files copied to `~/.cursor/plugins/local/<name>/`.
 * - Codex gets the files in a local Skillset marketplace, then `codex plugin add`.
 *
 * Every install is remembered beside the CLI's config, so `skillset plugins
 * update` can bring it up to date. Installing one already installed updates it.
 * Reads need no Token (ADR-0013).
 *
 * @param deps - The Registry session, home directory, whether a terminal is attached, how
 * to prompt for an agent, and how to run an agent's CLI.
 * @param options - The Plugin's name, plus `--namespace` and `--agent` when given.
 * @returns The Plugin, the agent chosen, every agent it supports, and what the install did.
 * @throws Error when no Registry is configured; when `--agent` is unknown or names an agent
 * the Plugin has no manifest for; when the Plugin supports several agents, `--agent` was
 * omitted, and no terminal is attached; when the agent's CLI is missing or fails; or,
 * naming the rule, when the downloaded Artifact fails inspection.
 * @throws ApiError when the Registry has no Plugin by that name, or refuses the download.
 * @throws RegistryUnreachableError when the Registry cannot be reached.
 * @example
 * ```ts
 * const result = await runPluginInstall(deps, { name: "review-suite", agent: "cursor" });
 * console.log(result.path); // -> "/Users/me/.cursor/plugins/local/review-suite"
 * ```
 */
export async function runPluginInstall(
  deps: PluginInstallDeps,
  options: PluginInstallOptions,
): Promise<PluginInstallResult> {
  const client = await openReadClient(deps);
  const plugin = await fetchPlugin(client, options.name, options.namespace);
  const agent = await chooseAgent(deps, plugin.agents, options.agent);
  const report = await installRegistryPlugin(pluginContext(deps), pluginRegistry(client), plugin, agent);
  return { ...report, name: plugin.name, namespace: plugin.namespace, supported_agents: plugin.agents };
}

export interface PluginUpdateOptions {
  /** One Plugin to update; every installed Plugin when omitted. */
  name?: string;
  namespace?: string;
  /** Only its install for this agent. */
  agent?: string;
  /** Reinstall even when the Registry has nothing newer. */
  force?: boolean;
}

/**
 * Brings Plugins the CLI installed up to date with the Registry.
 *
 * @remarks
 * Only Plugins installed with `skillset plugins install`, or the MCP server's
 * `install_plugin`, from the Registry configured now are known; one installed
 * some other way is left alone, as the JFrog CLI does. A Plugin whose revision (manifest version plus publish
 * time) is unchanged is reported current and not touched. One that failed
 * does not stop the rest.
 *
 * @param deps - As for {@link runPluginInstall}.
 * @param options - Which Plugin, Namespace and agent to update, and whether to force it.
 * @returns One outcome per installed Plugin and agent considered.
 * @throws Error when no Registry is configured, when `--agent` is unknown, or when the
 * named Plugin was never installed with Skillset.
 * @example
 * ```ts
 * const outcomes = await runPluginUpdate(deps, {});
 * ```
 */
export async function runPluginUpdate(
  deps: PluginInstallDeps,
  options: PluginUpdateOptions,
): Promise<PluginUpdateOutcome[]> {
  const client = await openReadClient(deps);
  const agent = options.agent === undefined ? undefined : parseAgent(options.agent);
  return updateRegistryPlugins(pluginContext(deps), pluginRegistry(client), { ...options, agent });
}
