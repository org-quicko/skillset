import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { SkillFile } from "./artifact.js";
import { splitFrontmatter } from "./frontmatter.js";

/** The longest description a component keeps; the full text stays in its file. */
const COMPONENT_DESCRIPTION_MAX_LENGTH = 300;

/** One thing a Plugin provides — a skill, command, agent, hook event, mod, or MCP server — and the file that defines it. */
export const PluginComponentSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  path: z.string(),
});
export type PluginComponent = z.infer<typeof PluginComponentSchema>;

/**
 * What a Plugin provides, read from its files at publish time.
 *
 * @remarks
 * The API never reads Artifact bytes (ADR-0001), so the publisher's client
 * reads these and declares them, the same trust as the manifest's
 * `description`. Read from the default layout only (`skills/`, `commands/`,
 * `agents/`, `hooks/hooks.json`, `.mcp.json`); a manifest that moves a
 * component to a custom path shows without it.
 *
 * `mods` are Claude Code's function-hook modules, which `hooks/hooks.json`
 * names under `modules`. It defaults to empty, so a Plugin stored or a
 * client built before the Registry read mods still parses.
 */
export const PluginComponentsSchema = z.object({
  skills: z.array(PluginComponentSchema),
  commands: z.array(PluginComponentSchema),
  agents: z.array(PluginComponentSchema),
  hooks: z.array(PluginComponentSchema),
  mods: z.array(PluginComponentSchema).default([]),
  mcp_servers: z.array(PluginComponentSchema),
});
export type PluginComponents = z.infer<typeof PluginComponentsSchema>;

const HOOKS_PATH = "hooks/hooks.json";
const MCP_PATH = ".mcp.json";

function text(file: SkillFile): string {
  return new TextDecoder().decode(file.bytes);
}

function short(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const trimmed = value.trim();
  return trimmed.length > COMPONENT_DESCRIPTION_MAX_LENGTH
    ? `${trimmed.slice(0, COMPONENT_DESCRIPTION_MAX_LENGTH - 1)}…`
    : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A markdown file's frontmatter as a plain object; empty when it has none or it does not parse. */
function frontmatterOf(file: SkillFile): Record<string, unknown> {
  const { frontmatter } = splitFrontmatter(text(file));
  if (frontmatter === null) return {};
  try {
    const parsed: unknown = parseYaml(frontmatter);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function jsonOf(file: SkillFile | undefined): Record<string, unknown> {
  if (!file) return {};
  try {
    const parsed: unknown = JSON.parse(text(file));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** A path relative to `from`'s folder, as a path from the Plugin's root; `null` when it climbs out of the Plugin. */
function resolveFrom(from: string, relative: string): string | null {
  const parts = from.split("/").slice(0, -1);
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

/** The mods `hooks/hooks.json` names under `modules`, each by its module's file; a module the Plugin does not hold is left out. */
function modComponents(hooksFile: Record<string, unknown>, paths: ReadonlySet<string>): PluginComponent[] {
  const modules = Array.isArray(hooksFile.modules) ? hooksFile.modules : [];
  return modules.flatMap((module) => {
    if (typeof module !== "string") return [];
    const path = resolveFrom(HOOKS_PATH, module);
    if (path === null || !paths.has(path)) return [];
    return [{ name: path.slice(path.lastIndexOf("/") + 1), description: null, path }];
  });
}

function markdownComponents(files: SkillFile[], pattern: RegExp): PluginComponent[] {
  return files.flatMap((file) => {
    const match = pattern.exec(file.path);
    if (!match?.[1]) return [];
    const frontmatter = frontmatterOf(file);
    return [{ name: short(frontmatter.name) ?? match[1], description: short(frontmatter.description), path: file.path }];
  });
}

/** What an MCP server entry runs or connects to, as one line. */
function mcpTarget(server: unknown): string | null {
  if (!isRecord(server)) return null;
  if (typeof server.url === "string") return server.url;
  if (typeof server.command !== "string") return null;
  const args = Array.isArray(server.args) ? server.args.filter((arg) => typeof arg === "string") : [];
  return short([server.command, ...args].join(" "));
}

/**
 * Lists what a Plugin provides, from its files.
 *
 * @remarks
 * Lenient by design: a component file whose frontmatter or JSON does not
 * parse still lists by its file name, and never fails the publish — the agent
 * that loads the Plugin is the judge of its contents, not the Registry.
 *
 * @param files - The Plugin's files, at paths relative to its root.
 * @param manifestPath - Where the primary manifest sits, named as the file of an inline component.
 * @param manifest - The parsed primary manifest; its inline `mcpServers` and `hooks` objects count too.
 * @returns The Plugin's skills, commands, agents, hook events, mods, and MCP servers.
 * @example
 * ```ts
 * pluginComponents(files, ".claude-plugin/plugin.json", manifest).skills; // -> [{ name: "lint", description: "Lints code.", path: "skills/lint/SKILL.md" }]
 * ```
 */
export function pluginComponents(
  files: SkillFile[],
  manifestPath: string,
  manifest: Record<string, unknown>,
): PluginComponents {
  const byPath = new Map(files.map((file) => [file.path, file]));

  const hooksFile = jsonOf(byPath.get(HOOKS_PATH));
  const hookSource = hooksFile.hooks;
  const hookPath = isRecord(hookSource) ? HOOKS_PATH : manifestPath;
  const hooks = isRecord(hookSource) ? hookSource : isRecord(manifest.hooks) ? manifest.hooks : {};

  const mcpFile = jsonOf(byPath.get(MCP_PATH));
  // A plugin's `.mcp.json` may wrap its servers in `mcpServers` or list them at the top level.
  const fileServers = isRecord(mcpFile.mcpServers) ? mcpFile.mcpServers : mcpFile;
  const inlineServers = isRecord(manifest.mcpServers) ? manifest.mcpServers : {};

  return {
    skills: markdownComponents(files, /^skills\/([^/]+)\/SKILL\.md$/),
    commands: markdownComponents(files, /^commands\/(.+)\.md$/),
    agents: markdownComponents(files, /^agents\/(.+)\.md$/),
    hooks: Object.keys(hooks).map((event) => ({ name: event, description: null, path: hookPath })),
    mods: modComponents(hooksFile, new Set(byPath.keys())),
    mcp_servers: [
      ...Object.entries(fileServers).map(([name, server]) => ({ name, description: mcpTarget(server), path: MCP_PATH })),
      ...Object.entries(inlineServers).map(([name, server]) => ({
        name,
        description: mcpTarget(server),
        path: manifestPath,
      })),
    ],
  };
}
