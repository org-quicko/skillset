import {
  claudeMarketplaceEntryName,
  extractArtifactFiles,
  PLUGIN_AGENT_IDS,
  PLUGIN_AGENTS,
  PluginSchema,
  registryNamespace,
  type PluginAgent,
} from "@in-org-quicko/skillset-shared";
import {
  installClaudeCodePlugin,
  installCodexPlugin,
  installCursorPlugin,
  type PluginInstallReport,
  type RunCommand,
} from "@in-org-quicko/skillset-installer";
import { rethrowValidationError } from "../errors.js";
import { downloadBinary, registryFetch } from "../http.js";
import { openReadClient, type SessionDeps } from "../session.js";

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
}

/** Every agent's id, followed by its label, for an error or a prompt. */
function describeAgents(agents: readonly PluginAgent[]): string {
  return agents.map((agent) => `${agent} (${PLUGIN_AGENTS[agent].label})`).join(", ");
}

/** The agent to install for: `--agent`, the only one the Plugin supports, or the User's pick. */
async function chooseAgent(
  deps: PluginInstallDeps,
  supported: readonly PluginAgent[],
  flag: string | undefined,
): Promise<PluginAgent> {
  if (flag !== undefined) {
    const agent = PLUGIN_AGENT_IDS.find((id) => id === flag);
    if (!agent)
      throw new Error(
        `Unknown agent "${flag}" — choose from: ${describeAgents(PLUGIN_AGENT_IDS)}.`,
      );
    if (!supported.includes(agent)) {
      throw new Error(
        `This Plugin has no ${PLUGIN_AGENTS[agent].label} manifest. It supports: ${describeAgents(supported)}.`,
      );
    }
    return agent;
  }
  const [only] = supported;
  if (supported.length === 1 && only) return only;
  if (!deps.isTTY)
    throw new Error(`Pass --agent: this Plugin supports ${describeAgents(supported)}.`);
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
 * way:
 *
 * - Claude Code adds the Registry's hosted `/.claude-plugin/marketplace.json`
 *   and runs `claude plugin install`, so Claude Code keeps it up to date.
 * - Cursor gets the files copied to `~/.cursor/plugins/local/<name>/`.
 * - Codex gets the files in a local Skillset marketplace, then `codex plugin add`.
 *
 * Reads need no Token (ADR-0013). Cursor and Codex download the Artifact,
 * which counts as an Install; Claude Code's download counts as a marketplace
 * Install (ADR-0028).
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
  const query = options.namespace ? `?namespace=${encodeURIComponent(options.namespace)}` : "";
  const plugin = await registryFetch(
    client,
    `/resources/plugin/by-name/${encodeURIComponent(options.name)}${query}`,
    PluginSchema,
  );
  const agent = await chooseAgent(deps, plugin.agents, options.agent);
  const context = { homeDir: deps.homeDir, run: deps.run };

  let report: PluginInstallReport;
  if (agent === "claude-code") {
    const isOwn = plugin.namespace === registryNamespace(client.registry);
    const entry = claudeMarketplaceEntryName(plugin.name, plugin.namespace, isOwn);
    report = await installClaudeCodePlugin(context, client.registry, entry);
  } else {
    const bytes = await downloadBinary(client, `/resources/${plugin.id}/artifact?source=cli`);
    let files;
    try {
      files = extractArtifactFiles(bytes);
    } catch (error) {
      rethrowValidationError(error);
    }
    report =
      agent === "cursor"
        ? await installCursorPlugin(context, plugin.name, files)
        : await installCodexPlugin(context, plugin.name, files);
  }

  return {
    ...report,
    name: plugin.name,
    namespace: plugin.namespace,
    supported_agents: plugin.agents,
  };
}
