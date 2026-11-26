import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CLAUDE_MARKETPLACE_PATH,
  claudeMarketplaceEntryName,
  extractArtifactFiles,
  formatSkillValidationError,
  PLUGIN_AGENT_IDS,
  PLUGIN_AGENTS,
  registryNamespace,
  SkillValidationError,
  type Plugin,
  type PluginAgent,
} from "@in-org-quicko/skillset-shared";
import { z } from "zod";
import {
  installClaudeCodePluginHosted,
  installClaudeCodePluginLocally,
  installCodexPlugin,
  installCursorPlugin,
  type PluginInstallContext,
  type PluginInstallMode,
  type PluginInstallReport,
} from "./plugin-install.js";

/** How a Registry Plugin reaches the installer: the CLI and the MCP server each supply their own HTTP. */
export interface PluginRegistry {
  /** The Registry's URL. */
  registry: string;
  /** Resolves a Plugin by name, and by Namespace when a bare name matches more than one (ADR-0042). */
  fetchPlugin(name: string, namespace: string | undefined): Promise<Plugin>;
  /** Downloads the Plugin's Artifact as zip bytes. */
  downloadArtifact(plugin: Plugin): Promise<Uint8Array>;
  /** The `name` the Registry's hosted Claude Code marketplace goes by, which an Admin can change. */
  marketplaceName(): Promise<string>;
}

/** Where a Plugin install runs, plus the file that remembers every install for `update`. */
export interface RegistryPluginContext extends PluginInstallContext {
  recordsPath: string;
}

/** Where a Claude Code install came from; `null` for agents that only ever install from a local copy. */
export type PluginVia = "hosted" | "local" | null;

/** What installing one Registry Plugin for one agent did. */
export interface RegistryPluginInstallReport extends PluginInstallReport {
  via: PluginVia;
}

/** What updating one installed Plugin did. */
export type PluginUpdateOutcome =
  | { name: string; namespace: string; agent: PluginAgent; status: "current"; revision: string }
  | { name: string; namespace: string; agent: PluginAgent; status: "updated"; from: string; to: string; next?: string }
  | { name: string; namespace: string; agent: PluginAgent; status: "failed"; message: string };

/** Which installed Plugins {@link updateRegistryPlugins} considers; omitted fields match all. */
export interface PluginUpdateFilter {
  name?: string;
  namespace?: string;
  agent?: PluginAgent;
  /** Reinstall even when the Registry has nothing newer. */
  force?: boolean;
}

/** The file beside Skillset's config that remembers Plugin installs. */
export const PLUGIN_RECORDS_FILE = "plugins.json";

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

/**
 * Decides where Skillset's config file lives, which the CLI and the MCP server share.
 *
 * @param env - The process environment; `SKILLSET_CONFIG_PATH` wins, then the conventional
 * per-OS location (`%APPDATA%\\skillset\\config.json` on Windows,
 * `$XDG_CONFIG_HOME/skillset/config.json` or `~/.config/skillset/config.json` elsewhere).
 * @returns An absolute path, which need not exist yet.
 *
 * @example
 * ```ts
 * resolveConfigPath({ XDG_CONFIG_HOME: "/home/dev/.config" });
 * // -> "/home/dev/.config/skillset/config.json"
 * ```
 */
export function resolveConfigPath(env: Record<string, string | undefined>): string {
  if (env.SKILLSET_CONFIG_PATH) return env.SKILLSET_CONFIG_PATH;
  if (env.APPDATA) return join(env.APPDATA, "skillset", "config.json");

  const configDir = env.XDG_CONFIG_HOME || join(env.HOME ?? env.USERPROFILE ?? "", ".config");
  return join(configDir, "skillset", "config.json");
}

async function readRecords(path: string): Promise<PluginInstallRecord[]> {
  try {
    return PluginRecordsSchema.parse(JSON.parse(await readFile(path, "utf8"))).plugins;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`${path} is not a valid Skillset plugins file.`);
  }
}

async function writeRecords(path: string, records: readonly PluginInstallRecord[]): Promise<void> {
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
 * Claude Code refuses a marketplace whose archive URLs fail this, so the installer
 * installs from a local copy instead. A hostname is not resolved, so a public name
 * pointing at a private address still reads as public.
 *
 * @param registry - The Registry's URL.
 * @returns `true` when the Registry's hosted marketplace is usable by Claude Code.
 * @throws TypeError when `registry` is not a URL.
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

/** Downloads and inspects a Plugin's Artifact; a failed inspection throws naming the rule it broke. */
async function downloadPluginFiles(source: PluginRegistry, plugin: Plugin) {
  const bytes = await source.downloadArtifact(plugin);
  try {
    return extractArtifactFiles(bytes);
  } catch (error) {
    if (error instanceof SkillValidationError) throw new Error(formatSkillValidationError(error));
    throw error;
  }
}

async function installForAgent(
  ctx: RegistryPluginContext,
  source: PluginRegistry,
  plugin: Plugin,
  agent: PluginAgent,
  previous: PluginInstallRecord | undefined,
): Promise<RegistryPluginInstallReport> {
  if (agent === "claude-code") {
    const via = servesHostedMarketplace(source.registry) ? "hosted" : "local";
    // Moving between hosted and local is a fresh install into the other marketplace.
    const mode: PluginInstallMode = previous?.via === via ? "update" : "install";
    if (via === "hosted") {
      const isOwn = plugin.namespace === registryNamespace(source.registry);
      const report = await installClaudeCodePluginHosted(
        ctx,
        {
          marketplaceUrl: new URL(CLAUDE_MARKETPLACE_PATH, source.registry).href,
          marketplaceName: await source.marketplaceName(),
          entry: claudeMarketplaceEntryName(plugin.name, plugin.namespace, isOwn),
        },
        mode,
      );
      return { ...report, via };
    }
    const files = await downloadPluginFiles(source, plugin);
    return { ...(await installClaudeCodePluginLocally(ctx, plugin.name, files, revisionOf(plugin), mode)), via };
  }
  const files = await downloadPluginFiles(source, plugin);
  const report =
    agent === "cursor"
      ? await installCursorPlugin(ctx, plugin.name, files)
      : await installCodexPlugin(ctx, plugin.name, files);
  return { ...report, via: null };
}

/**
 * Installs a Registry Plugin for one agent and remembers the install, so
 * {@link updateRegistryPlugins} can bring it up to date later.
 *
 * @remarks
 * Each agent installs its own way: Claude Code from the Registry's hosted marketplace when
 * {@link servesHostedMarketplace} allows it and from a local marketplace otherwise, Cursor by
 * copying the files to `~/.cursor/plugins/local/<name>/`, and Codex through a local Skillset
 * marketplace and `codex plugin add`. Installing one already installed updates it. The caller
 * decides `agent`; this does not check the Plugin has a manifest for it.
 *
 * @param ctx - The home directory, how to run an agent's CLI, and where install records live.
 * @param source - How to reach the Registry.
 * @param plugin - The Plugin, as the Registry reported it.
 * @param agent - The agent to install for.
 * @returns What the install did, and whether Claude Code got it hosted or locally.
 * @throws Error when the agent's CLI is missing or fails, when the records file is malformed,
 * or, naming the rule, when the downloaded Artifact fails inspection.
 * @example
 * ```ts
 * const report = await installRegistryPlugin(ctx, source, plugin, "cursor");
 * report.path; // -> "/Users/me/.cursor/plugins/local/review-suite"
 * ```
 */
export async function installRegistryPlugin(
  ctx: RegistryPluginContext,
  source: PluginRegistry,
  plugin: Plugin,
  agent: PluginAgent,
): Promise<RegistryPluginInstallReport> {
  const records = await readRecords(ctx.recordsPath);
  const key = { registry: source.registry, namespace: plugin.namespace, name: plugin.name, agent };
  const previous = records.find(sameInstall(key));
  const report = await installForAgent(ctx, source, plugin, agent, previous);
  const record: PluginInstallRecord = {
    ...key,
    id: plugin.id,
    revision: revisionOf(plugin),
    via: report.via,
    installed_at: new Date().toISOString(),
  };
  await writeRecords(ctx.recordsPath, [...records.filter((r) => !sameInstall(key)(r)), record]);
  return report;
}

/**
 * Brings remembered Plugin installs up to date with the Registry.
 *
 * @remarks
 * Only installs {@link installRegistryPlugin} recorded from `source.registry` are known; a
 * Plugin installed some other way is left alone. One whose revision (manifest version plus
 * publish time) is unchanged is reported current and not touched. One that failed does not
 * stop the rest.
 *
 * @param ctx - As for {@link installRegistryPlugin}.
 * @param source - How to reach the Registry.
 * @param filter - Which Plugin, Namespace and agent to update, and whether to force it.
 * @returns One outcome per installed Plugin and agent considered.
 * @throws Error when `filter.name` is set and no matching install was recorded, or when the
 * records file is malformed.
 * @example
 * ```ts
 * const outcomes = await updateRegistryPlugins(ctx, source, {});
 * ```
 */
export async function updateRegistryPlugins(
  ctx: RegistryPluginContext,
  source: PluginRegistry,
  filter: PluginUpdateFilter,
): Promise<PluginUpdateOutcome[]> {
  const installed = (await readRecords(ctx.recordsPath)).filter(
    (record) =>
      record.registry === source.registry &&
      (filter.name === undefined || record.name === filter.name) &&
      (filter.namespace === undefined || record.namespace === filter.namespace) &&
      (filter.agent === undefined || record.agent === filter.agent),
  );
  if (filter.name !== undefined && installed.length === 0) {
    throw new Error(`"${filter.name}" was not installed with Skillset from ${source.registry}.`);
  }

  const outcomes: PluginUpdateOutcome[] = [];
  for (const record of installed) {
    const base = { name: record.name, namespace: record.namespace, agent: record.agent };
    try {
      const plugin = await source.fetchPlugin(record.name, record.namespace);
      if (!plugin.agents.includes(record.agent)) {
        throw new Error(`It no longer has a ${PLUGIN_AGENTS[record.agent].label} manifest.`);
      }
      const revision = revisionOf(plugin);
      if (revision === record.revision && !filter.force) {
        outcomes.push({ ...base, status: "current", revision });
        continue;
      }
      const report = await installRegistryPlugin(ctx, source, plugin, record.agent);
      outcomes.push({ ...base, status: "updated", from: record.revision, to: revision, next: report.next });
    } catch (error) {
      outcomes.push({ ...base, status: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }
  return outcomes;
}
