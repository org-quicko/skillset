import type { AgentId, ResolveContext, Scope } from "./table.js";

/**
 * The one Agent a Subagent can be installed for (ADR-0047). Another is added
 * once its own directory and file format have been verified against its
 * documentation.
 */
export const SUBAGENT_AGENT_ID: AgentId = "claude-code";

/**
 * The directory Claude Code reads Subagents from at `scope`.
 *
 * @param scope - "project" for `<projectRoot>/.claude/agents`, "user" for
 * `$CLAUDE_CONFIG_DIR/agents`, falling back to `~/.claude/agents`.
 * @param ctx - The environment, home directory, and project root to resolve against.
 * @returns A POSIX-style path.
 * @example
 * ```ts
 * subagentsDir("project", { env: {}, homeDir: "/home/dev", projectRoot: "/repo" });
 * // -> "/repo/.claude/agents"
 * ```
 */
export function subagentsDir(scope: Scope, ctx: ResolveContext): string {
  if (scope === "project") return `${ctx.projectRoot}/.claude/agents`;
  const configDir = ctx.env.CLAUDE_CONFIG_DIR?.trim();
  return `${configDir || `${ctx.homeDir}/.claude`}/agents`;
}
