import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CLAUDE_MARKETPLACE_NAME,
  CLAUDE_MARKETPLACE_PATH,
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

/**
 * Installs a Plugin for Claude Code from the Registry's hosted marketplace.
 *
 * @remarks
 * Claude Code reads a marketplace straight from a URL, so nothing is written
 * here: `claude` adds `<registry>/.claude-plugin/marketplace.json` (or
 * refreshes it when it is already added) and downloads the Plugin itself.
 *
 * @param context - The home directory and how to run `claude`.
 * @param registry - The Registry's origin, e.g. `https://skills.acme.com`.
 * @param entry - The Plugin's name in the marketplace, from `claudeMarketplaceEntryName`.
 * @returns The commands run.
 * @throws Error when `claude` is not on PATH, or naming the command and its output when one fails.
 * @example
 * ```ts
 * await installClaudeCodePlugin({ homeDir, run: runCommand }, "https://skills.acme.com", "review-suite");
 * ```
 */
export async function installClaudeCodePlugin(
  context: PluginInstallContext,
  registry: string,
  entry: string,
): Promise<PluginInstallReport> {
  const commands: string[] = [];
  const marketplaceUrl = `${registry.replace(/\/+$/, "")}${CLAUDE_MARKETPLACE_PATH}`;
  await addOrRefreshMarketplace(
    context,
    "claude-code",
    commands,
    "claude",
    ["plugin", "marketplace", "add", marketplaceUrl],
    ["plugin", "marketplace", "update", CLAUDE_MARKETPLACE_NAME],
  );
  await runOrThrow(context, "claude-code", commands, "claude", [
    "plugin",
    "install",
    `${entry}@${CLAUDE_MARKETPLACE_NAME}`,
  ]);
  return { agent: "claude-code", path: null, commands };
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
