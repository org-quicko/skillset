import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CLAUDE_MARKETPLACE_PATH,
  claudeMarketplaceEntryName,
  extractArtifactFiles,
  PLUGIN_AGENT_IDS,
  PLUGIN_AGENTS,
  PluginSchema,
  registryNamespace,
  type Plugin,
  type PluginAgent,
} from "@in-org-quicko/skillset-shared";
import {
  installClaudeCodePluginHosted,
  installClaudeCodePluginLocally,
  installCodexPlugin,
  installCursorPlugin,
  type PluginInstallMode,
  type PluginInstallReport,
  type RunCommand,
} from "@in-org-quicko/skillset-installer";
import { z } from "zod";
import { rethrowValidationError } from "../errors.js";
import { downloadBinary, registryFetch, RegistryUnreachableError, type RegistryClient } from "../http.js";
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
  /** How Claude Code got it: from the Registry's hosted marketplace, or a local copy. `null` for other agents. */
  via: PluginSource;
}

/** Where a Claude Code install came from; `null` for agents that only ever install from a local copy. */
type PluginSource = "hosted" | "local" | null;

/** One Plugin the CLI installed for one agent, remembered so `skillset plugins update` can find it. */
const PluginInstallRecordSchema = z.object({
  registry: z.string(),
  id: z.string(),
  name: z.string(),
  namespace: z.string(),
  agent: z.enum(PLUGIN_AGENT_IDS),
  /** The Plugin's version as the Registry had it, e.g. `1.2.0+1717000000`. */
  revision: z.string(),
  via: z.enum(["hosted", "local"]).nullable(),
  installed_at: z.string(),
});
type PluginInstallRecord = z.infer<typeof PluginInstallRecordSchema>;

const PluginRecordsSchema = z.object({ plugins: z.array(PluginInstallRecordSchema) });

/** Where the CLI remembers its Plugin installs: beside its config file. */
function recordsPath(deps: SessionDeps): string {
  return join(dirname(deps.configPath), "plugins.json");
}

async function readRecords(deps: SessionDeps): Promise<PluginInstallRecord[]> {
  try {
    return PluginRecordsSchema.parse(JSON.parse(await readFile(recordsPath(deps), "utf8"))).plugins;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`${recordsPath(deps)} is not a valid Skillset plugins file.`);
  }
}

async function writeRecords(deps: SessionDeps, records: readonly PluginInstallRecord[]): Promise<void> {
  const path = recordsPath(deps);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ plugins: records }, null, 2)}\n`);
}

function sameInstall(a: Pick<PluginInstallRecord, "registry" | "namespace" | "name" | "agent">) {
  return (b: PluginInstallRecord) =>
    b.registry === a.registry && b.namespace === a.namespace && b.name === a.name && b.agent === a.agent;
}

/**
 * A Plugin's revision: its manifest version plus when it was last published, the same
 * version the Registry's Claude Code marketplace gives it, so a republish of an unchanged
 * manifest version still reads as new (ADR-0002).
 */
function revisionOf(plugin: Plugin): string {
  return `${plugin.version ?? "0.0.0"}+${Math.floor(new Date(plugin.updated_at).getTime() / 1000)}`;
}

/**
 * Whether Claude Code accepts Plugin archives from this Registry: HTTPS, and not on a
 * loopback, private, or link-local host.
 *
 * @remarks
 * Claude Code refuses a marketplace whose archive URLs fail this, so the CLI installs
 * from a local copy instead. A hostname is not resolved, so a public name pointing at
 * a private address still reads as public.
 *
 * @param registry - The Registry's URL.
 * @returns `true` when the Registry's hosted marketplace is usable by Claude Code.
 * @example
 * ```ts
 * servesHostedMarketplace("https://skills.acme.com"); // -> true
 * servesHostedMarketplace("http://localhost:3000"); // -> false
 * ```
 */
export function servesHostedMarketplace(registry: string): boolean {
  const url = new URL(registry);
  if (url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return false;
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return true;
  const [a = 0, b = 0] = octets;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
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

async function downloadPluginFiles(client: RegistryClient, plugin: Plugin) {
  const bytes = await downloadBinary(client, `/resources/${plugin.id}/artifact?source=cli`);
  try {
    return extractArtifactFiles(bytes);
  } catch (error) {
    rethrowValidationError(error);
  }
}

/** Installs, or updates, one Plugin for one agent, the way that agent takes it. */
async function installForAgent(
  deps: PluginInstallDeps,
  client: RegistryClient,
  plugin: Plugin,
  agent: PluginAgent,
  previous: PluginInstallRecord | undefined,
): Promise<{ report: PluginInstallReport; via: PluginSource }> {
  const context = { homeDir: deps.homeDir, run: deps.run };
  if (agent === "claude-code") {
    const via = servesHostedMarketplace(client.registry) ? "hosted" : "local";
    // Moving between hosted and local is a fresh install into the other marketplace.
    const mode: PluginInstallMode = previous?.via === via ? "update" : "install";
    if (via === "hosted") {
      const isOwn = plugin.namespace === registryNamespace(client.registry);
      const report = await installClaudeCodePluginHosted(
        context,
        {
          marketplaceUrl: new URL(CLAUDE_MARKETPLACE_PATH, client.registry).href,
          marketplaceName: await hostedMarketplaceName(client),
          entry: claudeMarketplaceEntryName(plugin.name, plugin.namespace, isOwn),
        },
        mode,
      );
      return { report, via };
    }
    const files = await downloadPluginFiles(client, plugin);
    return {
      report: await installClaudeCodePluginLocally(context, plugin.name, files, revisionOf(plugin), mode),
      via,
    };
  }
  const files = await downloadPluginFiles(client, plugin);
  const report =
    agent === "cursor"
      ? await installCursorPlugin(context, plugin.name, files)
      : await installCodexPlugin(context, plugin.name, files);
  return { report, via: null };
}

/** Installs a Plugin and remembers it, replacing any record of the same install. */
async function installAndRecord(
  deps: PluginInstallDeps,
  client: RegistryClient,
  plugin: Plugin,
  agent: PluginAgent,
): Promise<{ report: PluginInstallReport; via: PluginSource }> {
  const records = await readRecords(deps);
  const key = { registry: client.registry, namespace: plugin.namespace, name: plugin.name, agent };
  const previous = records.find(sameInstall(key));
  const result = await installForAgent(deps, client, plugin, agent, previous);
  const record: PluginInstallRecord = {
    ...key,
    id: plugin.id,
    revision: revisionOf(plugin),
    via: result.via,
    installed_at: new Date().toISOString(),
  };
  await writeRecords(deps, [...records.filter((r) => !sameInstall(key)(r)), record]);
  return result;
}

async function fetchPlugin(client: RegistryClient, name: string, namespace: string | undefined): Promise<Plugin> {
  const query = namespace ? `?namespace=${encodeURIComponent(namespace)}` : "";
  return registryFetch(client, `/resources/plugin/by-name/${encodeURIComponent(name)}${query}`, PluginSchema);
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
  const { report, via } = await installAndRecord(deps, client, plugin, agent);
  return { ...report, name: plugin.name, namespace: plugin.namespace, supported_agents: plugin.agents, via };
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

/** What `skillset plugins update` did with one installed Plugin. */
export type PluginUpdateOutcome =
  | { name: string; namespace: string; agent: PluginAgent; status: "current"; revision: string }
  | { name: string; namespace: string; agent: PluginAgent; status: "updated"; from: string; to: string; next?: string }
  | { name: string; namespace: string; agent: PluginAgent; status: "failed"; message: string };

/**
 * Brings Plugins the CLI installed up to date with the Registry.
 *
 * @remarks
 * Only Plugins installed with `skillset plugins install` from the Registry
 * configured now are known; one installed some other way is left alone, as
 * the JFrog CLI does. A Plugin whose revision (manifest version plus publish
 * time) is unchanged is reported current and not touched. One that failed
 * does not stop the rest.
 *
 * @param deps - As for {@link runPluginInstall}.
 * @param options - Which Plugin, Namespace and agent to update, and whether to force it.
 * @returns One outcome per installed Plugin and agent considered.
 * @throws Error when no Registry is configured, when `--agent` is unknown, or when the
 * named Plugin was never installed with the CLI.
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
  const installed = (await readRecords(deps)).filter(
    (record) =>
      record.registry === client.registry &&
      (options.name === undefined || record.name === options.name) &&
      (options.namespace === undefined || record.namespace === options.namespace) &&
      (agent === undefined || record.agent === agent),
  );
  if (options.name !== undefined && installed.length === 0) {
    throw new Error(`"${options.name}" was not installed with \`skillset plugins install\` from ${client.registry}.`);
  }

  const outcomes: PluginUpdateOutcome[] = [];
  for (const record of installed) {
    const base = { name: record.name, namespace: record.namespace, agent: record.agent };
    try {
      const plugin = await fetchPlugin(client, record.name, record.namespace);
      if (!plugin.agents.includes(record.agent)) {
        throw new Error(`It no longer has a ${PLUGIN_AGENTS[record.agent].label} manifest.`);
      }
      const revision = revisionOf(plugin);
      if (revision === record.revision && !options.force) {
        outcomes.push({ ...base, status: "current", revision });
        continue;
      }
      const { report } = await installAndRecord(deps, client, plugin, record.agent);
      outcomes.push({ ...base, status: "updated", from: record.revision, to: revision, next: report.next });
    } catch (error) {
      outcomes.push({ ...base, status: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }
  return outcomes;
}
