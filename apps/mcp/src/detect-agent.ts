import { existsSync } from "node:fs";
import { type AgentDetection, detectAgent, nonUniversalProjectSkillsDirs } from "@in-org-quicko/skillset-shared";
import type { InstallContext } from "@in-org-quicko/skillset-installer";
import type { McpConfig } from "./config.js";

/**
 * Resolves which Agent to install for, running the shared detection ladder against this
 * process's surroundings (spec, "Detecting the Agent").
 *
 * This is the node-only glue around {@link detectAgent}: it is the one place that touches the
 * filesystem, statting each non-universal Agent's project directory so the pure resolver never
 * has to.
 *
 * @param config - The resolved server configuration; its `agentId` is the `--agent` override
 * when the User set one.
 * @param clientName - The MCP client's self-reported `clientInfo.name`, from
 * `server.getClientVersion()`, or `undefined` before the client has identified itself.
 * @param ctx - The project root, environment, and home directory to resolve and stat against.
 * @returns The identified Agent (or `null` for the canonical fallback) and the rung that
 * resolved it.
 * @throws Error when `config.agentId` is set but names no Agent — surfaced from
 * {@link detectAgent}; `parseConfig` already rejects this at startup, so it is not reachable
 * in normal operation.
 *
 * @example
 * ```ts
 * resolveAgent(config, server.server.getClientVersion()?.name, { cwd, env: process.env, homeDir });
 * // -> { agentId: "claude-code", step: "client-identity" }
 * ```
 */
export function resolveAgent(config: McpConfig, clientName: string | undefined, ctx: InstallContext): AgentDetection {
  const resolveCtx = { env: ctx.env, homeDir: ctx.homeDir, projectRoot: ctx.cwd };
  const agentDirsPresent = nonUniversalProjectSkillsDirs(resolveCtx)
    .filter(({ dir }) => existsSync(dir))
    .map(({ agentId }) => agentId);

  return detectAgent({ override: config.agentId, clientName, env: ctx.env, agentDirsPresent });
}
