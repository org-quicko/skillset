import type { McpbManifestAny } from "@anthropic-ai/mcpb";
import pkg from "../package.json" with { type: "json" };
import type { DiscoveryDocument } from "./discovery.js";

/**
 * The bundle's name, which is deliberately not `skillset-mcp`.
 *
 * @remarks
 * Claude Code and Cowork refuse to start a bundle whose name contains the
 * substring `skillset` anywhere, as a reserved internal server name — so
 * neither the package name nor any qualified form of the word will do
 * (ADR-0037). A test holds this.
 */
export const MCPB_NAME = "skill-registry";

/**
 * Builds the MCPB `manifest.json` the `.mcpb` bundle is packed with.
 *
 * @param discovery - The server as it reports itself, from
 * `buildDiscoveryDocument` — the source of every tool the manifest lists.
 * @returns A manifest in MCPB format 0.3.
 *
 * @remarks
 * Generated at pack time rather than kept in the repository, so the bundle's
 * version, description, license, and tools cannot drift from `package.json`
 * and the server the way a hand-kept copy did. What is written here is only
 * what nothing else knows: the display name, how a host runs the server, and
 * the two settings it asks for on install (ADR-0037) — `registry`, required,
 * and a writer `token` marked `sensitive` so a host keeps it out of plain
 * config (ADR-0035).
 *
 * Tools carry their full descriptions, the same ones an Agent sees, so a host
 * showing them before install shows what the server actually does.
 *
 * @example
 * ```ts
 * const manifest = buildMcpbManifest(await buildDiscoveryDocument());
 * ```
 */
export function buildMcpbManifest(discovery: DiscoveryDocument): McpbManifestAny {
  return {
    manifest_version: "0.3",
    name: MCPB_NAME,
    display_name: "Skill Registry",
    version: pkg.version,
    description: pkg.description,
    long_description:
      "Search a team's self-hosted Skillset Registry, install Skills into this project for the detected Agent, and " +
      "publish a Skill to the Registry, from this project or from a repository you can clone. Reads need no " +
      "credential; publishing needs a writer Token.",
    author: { name: "Quicko" },
    repository: { type: "git", url: "https://github.com/org-quicko/skillset" },
    license: pkg.license,
    server: {
      type: "node",
      entry_point: "dist/cli.js",
      mcp_config: {
        command: "node",
        args: ["${__dirname}/dist/cli.js", "--registry", "${user_config.registry}"],
        env: { SKILLSET_TOKEN: "${user_config.token}" },
      },
    },
    tools: discovery.tools.map((tool) => ({ name: tool.name, description: tool.description ?? "" })),
    tools_generated: false,
    user_config: {
      registry: {
        type: "string",
        title: "Registry URL",
        description: "The self-hosted Skillset Registry to talk to.",
        required: true,
      },
      token: {
        type: "string",
        title: "Writer Token",
        description: "Only needed to publish a Skill with publish_skill. Reads need no Token.",
        sensitive: true,
        required: false,
      },
    },
    compatibility: { runtimes: { node: ">=18" } },
  };
}
