import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  PLUGIN_AGENTS,
  pluginAgentsForPaths,
  type PluginAgent,
  type SkillFile,
} from "@in-org-quicko/skillset-shared";

/** What a finished command left behind. `code` is `null` when the command is not on PATH. */
export interface CommandResult {
  code: number | null;
  output: string;
}

/** Runs one command without a shell and reports how it ended; never rejects. */
export type RunCommand = (command: string, args: readonly string[]) => Promise<CommandResult>;

/**
 * Runs a command with Node's `execFile`, folding stdout and stderr into one output.
 *
 * @remarks
 * Never rejects, so a caller can try one command and fall back to another on
 * failure. A command missing from PATH reads as `code: null`.
 *
 * @param command - The executable, looked up on PATH.
 * @param args - Its arguments, passed as they are, never through a shell.
 * @returns The exit code and everything the command printed.
 * @example
 * ```ts
 * const { code } = await runCommand("claude", ["--version"]);
 * ```
 */
export function runCommand(command: string, args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      const output = `${stdout}${stderr}`.trim();
      if (!error) return resolve({ code: 0, output });
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return resolve({ code: null, output: "" });
      resolve({
        code: typeof error.code === "number" ? error.code : 1,
        output: output || error.message,
      });
    });
  });
}

/** Where a Plugin install runs: the home directory the agents read, and how to run their CLIs. */
export interface PluginInstallContext {
  homeDir: string;
  run: RunCommand;
}

/** What installing a Plugin for one agent did. */
export interface PluginInstallReport {
  agent: PluginAgent;
  /** Where the Plugin's files were written; `null` when the agent's own CLI fetched them. */
  path: string | null;
  /** The agent CLI commands that were run, in order, as typed. */
  commands: string[];
  /** What the User still has to do for the agent to load the Plugin, if anything. */
  next?: string;
}

/** The marketplace name the Registry's Plugins are installed under in a local Codex marketplace. */
export const CODEX_MARKETPLACE_NAME = "skillset";

/**
 * The marketplace name of the local Claude Code marketplace the CLI writes when the Registry's
 * hosted one cannot be used. Not `skillset`, so it never collides with the hosted marketplace.
 */
export const CLAUDE_LOCAL_MARKETPLACE_NAME = "skillset-local";

/** Whether to install a Plugin afresh, or update one already installed from the same place. */
export type PluginInstallMode = "install" | "update";

/** One `plugins` entry of the local Claude Code marketplace file. */
interface ClaudeLocalMarketplaceEntry {
  name: string;
  source: string;
  version: string;
}

/** The local Claude Code marketplace file, as far as the CLI writes it. */
interface ClaudeLocalMarketplace {
  name: string;
  owner: { name: string };
  plugins: ClaudeLocalMarketplaceEntry[];
}

/** One `plugins` entry of a Codex marketplace file. */
interface CodexMarketplaceEntry {
  name: string;
  source: { source: "local"; path: string };
  policy: { installation: "AVAILABLE" };
  category: string;
}

/** A Codex marketplace file, as far as the Registry writes it. */
interface CodexMarketplace {
  name: string;
  interface: { displayName: string };
  plugins: CodexMarketplaceEntry[];
}

function commandLine(command: string, args: readonly string[]): string {
  return [command, ...args].join(" ");
}

function missingCliError(command: string, agent: PluginAgent): Error {
  return new Error(
    `${PLUGIN_AGENTS[agent].label}'s \`${command}\` CLI is not on PATH — install it, then try again.`,
  );
}

/** Runs one agent CLI command, recording it, and throws with its output when it fails. */
async function runOrThrow(
  context: PluginInstallContext,
  agent: PluginAgent,
  commands: string[],
  command: string,
  args: readonly string[],
): Promise<void> {
  commands.push(commandLine(command, args));
  const result = await context.run(command, args);
  if (result.code === null) throw missingCliError(command, agent);
  if (result.code !== 0)
    throw new Error(`\`${commandLine(command, args)}\` failed: ${result.output}`);
}

/**
 * Registers a marketplace with an agent CLI: `add` first, and when that fails because it is
 * already known, `refresh` instead. Throws the `add` failure when both fail.
 */
async function addOrRefreshMarketplace(
  context: PluginInstallContext,
  agent: PluginAgent,
  commands: string[],
  command: string,
  add: readonly string[],
  refresh: readonly string[],
): Promise<void> {
  commands.push(commandLine(command, add));
  const added = await context.run(command, add);
  if (added.code === null) throw missingCliError(command, agent);
  if (added.code === 0) return;
  commands.push(commandLine(command, refresh));
  const refreshed = await context.run(command, refresh);
  if (refreshed.code !== 0)
    throw new Error(`\`${commandLine(command, add)}\` failed: ${added.output}`);
}

/** Replaces `dir` with exactly `files`, so a file the Plugin dropped since the last install is gone. */
async function writePluginFiles(dir: string, files: readonly SkillFile[]): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  for (const file of files) {
    const target = join(dir, ...file.path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.bytes);
  }
}

async function readCodexMarketplace(path: string): Promise<CodexMarketplace> {
  const fresh: CodexMarketplace = {
    name: CODEX_MARKETPLACE_NAME,
    interface: { displayName: "Skillset" },
    plugins: [],
  };
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<CodexMarketplace>;
    return { ...fresh, plugins: Array.isArray(parsed.plugins) ? parsed.plugins : [] };
  } catch {
    return fresh;
  }
}

/** Where the Claude Code marketplace is, and which Plugin in it to install. */
export interface ClaudeHostedTarget {
  /** The Registry's hosted marketplace URL, e.g. `https://skills.acme.com/.claude-plugin/marketplace.json`. */
  marketplaceUrl: string;
  /** The marketplace's `name`, as the Registry serves it. */
  marketplaceName: string;
  /** The Plugin's entry name in it, from `claudeMarketplaceEntryName`. */
  entry: string;
}

/**
 * Installs or updates a Plugin for Claude Code from the Registry's hosted marketplace.
 *
 * @remarks
 * Claude Code reads the marketplace straight from its URL and downloads the
 * Plugin itself, so nothing is written here. Installing adds the marketplace
 * (or refreshes it when already added) and runs `claude plugin install`;
 * updating refreshes it and runs `claude plugin update`. Claude Code only
 * accepts this over HTTPS on a public host.
 *
 * @param context - The home directory and how to run `claude`.
 * @param target - The marketplace URL and name, and the Plugin's entry in it.
 * @param mode - `install`, or `update` for a Plugin already installed from it.
 * @returns The commands run.
 * @throws Error when `claude` is not on PATH, or naming the command and its output when one fails.
 * @example
 * ```ts
 * await installClaudeCodePluginHosted(context, {
 *   marketplaceUrl: "https://skills.acme.com/.claude-plugin/marketplace.json",
 *   marketplaceName: "skillset",
 *   entry: "review-suite",
 * }, "install");
 * ```
 */
export async function installClaudeCodePluginHosted(
  context: PluginInstallContext,
  target: ClaudeHostedTarget,
  mode: PluginInstallMode,
): Promise<PluginInstallReport> {
  const commands: string[] = [];
  const plugin = `${target.entry}@${target.marketplaceName}`;
  if (mode === "update") {
    await runOrThrow(context, "claude-code", commands, "claude", ["plugin", "marketplace", "update", target.marketplaceName]);
    await runOrThrow(context, "claude-code", commands, "claude", ["plugin", "update", plugin]);
  } else {
    await addOrRefreshMarketplace(
      context,
      "claude-code",
      commands,
      "claude",
      ["plugin", "marketplace", "add", target.marketplaceUrl],
      ["plugin", "marketplace", "update", target.marketplaceName],
    );
    await runOrThrow(context, "claude-code", commands, "claude", ["plugin", "install", plugin]);
  }
  return { agent: "claude-code", path: null, commands, next: "Restart Claude Code to load it." };
}

async function readClaudeLocalMarketplace(path: string): Promise<ClaudeLocalMarketplace> {
  const fresh: ClaudeLocalMarketplace = { name: CLAUDE_LOCAL_MARKETPLACE_NAME, owner: { name: "Skillset" }, plugins: [] };
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<ClaudeLocalMarketplace>;
    return { ...fresh, plugins: Array.isArray(parsed.plugins) ? parsed.plugins : [] };
  } catch {
    return fresh;
  }
}

/**
 * Installs or updates a Plugin for Claude Code through a local Skillset marketplace.
 *
 * @remarks
 * Used when the Registry's hosted marketplace cannot be: Claude Code refuses a
 * Plugin archive that is not HTTPS or that is on a local or private host. The
 * Plugin is written beside a marketplace file under
 * `~/.claude/plugins/local/skillset/`, that marketplace is added to Claude Code
 * (or refreshed), and the Plugin is installed or updated from it — the way the
 * JFrog CLI does. The entry's version carries `revision`, so Claude Code sees a
 * republish as a new version even when the manifest's version is unchanged.
 *
 * @param context - The home directory and how to run `claude`.
 * @param name - The Plugin's name, which names its directory and marketplace entry.
 * @param files - The Plugin's files, from `extractArtifactFiles`.
 * @param revision - The Plugin's version as the Registry has it, e.g. `1.2.0+1717000000`.
 * @param mode - `install`, or `update` for a Plugin already installed from it.
 * @returns Where the files were written, and the commands run.
 * @throws Error when the files hold no `.claude-plugin/plugin.json`, when `claude` is not on
 * PATH, or naming the command and its output when one fails.
 * @example
 * ```ts
 * await installClaudeCodePluginLocally(context, "review-suite", files, "1.2.0+1717000000", "install");
 * ```
 */
export async function installClaudeCodePluginLocally(
  context: PluginInstallContext,
  name: string,
  files: readonly SkillFile[],
  revision: string,
  mode: PluginInstallMode,
): Promise<PluginInstallReport> {
  requireManifest("claude-code", files);
  const root = join(context.homeDir, ".claude", "plugins", "local", "skillset");
  const path = join(root, name);
  await writePluginFiles(path, files);

  const marketplacePath = join(root, ".claude-plugin", "marketplace.json");
  const marketplace = await readClaudeLocalMarketplace(marketplacePath);
  const entry: ClaudeLocalMarketplaceEntry = { name, source: `./${name}`, version: revision };
  marketplace.plugins = [...marketplace.plugins.filter((plugin) => plugin.name !== name), entry];
  await mkdir(dirname(marketplacePath), { recursive: true });
  await writeFile(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`);

  const commands: string[] = [];
  await addOrRefreshMarketplace(
    context,
    "claude-code",
    commands,
    "claude",
    ["plugin", "marketplace", "add", root],
    ["plugin", "marketplace", "update", CLAUDE_LOCAL_MARKETPLACE_NAME],
  );
  await runOrThrow(context, "claude-code", commands, "claude", [
    "plugin",
    mode,
    `${name}@${CLAUDE_LOCAL_MARKETPLACE_NAME}`,
  ]);
  return { agent: "claude-code", path, commands, next: "Restart Claude Code to load it." };
}

/**
 * Installs a Plugin for Cursor by copying it into Cursor's local plugins directory.
 *
 * @remarks
 * Cursor has no command to install a Plugin and cannot read a marketplace from
 * a URL, so the files go to `~/.cursor/plugins/local/<name>/`, which Cursor
 * loads after a reload. A previous install of the same name is replaced.
 *
 * @param context - The home directory.
 * @param name - The Plugin's name, which names its directory.
 * @param files - The Plugin's files, from `extractArtifactFiles`.
 * @returns Where the files were written, and the reload the User still has to do.
 * @throws Error when the files hold no `.cursor-plugin/plugin.json`.
 * @example
 * ```ts
 * await installCursorPlugin({ homeDir, run: runCommand }, "review-suite", files);
 * ```
 */
export async function installCursorPlugin(
  context: PluginInstallContext,
  name: string,
  files: readonly SkillFile[],
): Promise<PluginInstallReport> {
  requireManifest("cursor", files);
  const path = join(context.homeDir, ".cursor", "plugins", "local", name);
  await writePluginFiles(path, files);
  return {
    agent: "cursor",
    path,
    commands: [],
    next: 'Restart Cursor, or run "Developer: Reload Window", to load it.',
  };
}

/**
 * Installs a Plugin for Codex through a local Skillset marketplace.
 *
 * @remarks
 * Codex clones any marketplace URL as git, so it cannot read the Registry's
 * directly. Instead the Plugin is written beside a marketplace file under
 * `~/.agents/plugins/local/skillset/`, that marketplace is added to Codex
 * (once; a later add fails and is ignored), and `codex plugin add` installs
 * from it — the same way the JFrog CLI does.
 *
 * @param context - The home directory and how to run `codex`.
 * @param name - The Plugin's name, which names its directory and marketplace entry.
 * @param files - The Plugin's files, from `extractArtifactFiles`.
 * @returns Where the files were written, and the commands run.
 * @throws Error when the files hold no `.codex-plugin/plugin.json`, when `codex` is not on
 * PATH, or naming the command and its output when `codex plugin add` fails.
 * @example
 * ```ts
 * await installCodexPlugin({ homeDir, run: runCommand }, "review-suite", files);
 * ```
 */
export async function installCodexPlugin(
  context: PluginInstallContext,
  name: string,
  files: readonly SkillFile[],
): Promise<PluginInstallReport> {
  requireManifest("codex", files);
  const root = join(context.homeDir, ".agents", "plugins", "local", CODEX_MARKETPLACE_NAME);
  const path = join(root, name);
  await writePluginFiles(path, files);

  const marketplacePath = join(root, ".agents", "plugins", "marketplace.json");
  const marketplace = await readCodexMarketplace(marketplacePath);
  const entry: CodexMarketplaceEntry = {
    name,
    source: { source: "local", path: `./${name}` },
    policy: { installation: "AVAILABLE" },
    category: "Productivity",
  };
  marketplace.plugins = [...marketplace.plugins.filter((plugin) => plugin.name !== name), entry];
  await mkdir(dirname(marketplacePath), { recursive: true });
  await writeFile(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`);

  const commands: string[] = [];
  const addMarketplace = ["plugin", "marketplace", "add", root];
  commands.push(commandLine("codex", addMarketplace));
  const added = await context.run("codex", addMarketplace);
  if (added.code === null) throw missingCliError("codex", "codex");
  await runOrThrow(context, "codex", commands, "codex", [
    "plugin",
    "add",
    `${name}@${CODEX_MARKETPLACE_NAME}`,
  ]);
  return { agent: "codex", path, commands };
}

function requireManifest(agent: PluginAgent, files: readonly SkillFile[]): void {
  if (!pluginAgentsForPaths(files.map((file) => file.path)).includes(agent)) {
    throw new Error(
      `This Plugin has no ${PLUGIN_AGENTS[agent].manifestPath}, so it cannot be installed for ${PLUGIN_AGENTS[agent].label}.`,
    );
  }
}
