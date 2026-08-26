/**
 * `claude-code`, `codex`, `github-copilot`, `opencode`, and `pi`'s directories and
 * environment overrides are derived from `vercel-labs/skills` (MIT), `src/agents.ts` at
 * commit `dd3ca3c85581e593434546a4016fb3a7e7b7f937` (2026-08-18) — the five Agents
 * ADR-0006 verifies. See LICENSE.vercel-labs-skills in this directory for the upstream
 * copyright notice and licence text. `generic` is our own addition, not upstream's — see
 * docs/adr/0014.
 *
 * Paths are POSIX-style strings, relative to a project root or a home directory, never
 * touching `node:path` or `node:os` — this module is shared with the browser (spec,
 * "Shape"). The CLI resolves these against the real filesystem.
 */

export type AgentId = "claude-code" | "codex" | "github-copilot" | "opencode" | "pi" | "generic";
export type Scope = "project" | "user";

export interface AgentEntry {
  id: AgentId;
  displayName: string;
  /** Relative to a project root. */
  projectSkillsDir: string;
  /**
   * The Skill directory at "user" Scope.
   *
   * @param env - The process environment, read for this Agent's own
   * configuration-directory override where it has one. A blank or whitespace-only value
   * counts as unset.
   * @param homeDir - The User's home directory, used when no override applies.
   * @returns An absolute, POSIX-style path.
   */
  userSkillsDir(env: Record<string, string | undefined>, homeDir: string): string;
}

function trimmedEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export const AGENTS: readonly AgentEntry[] = [
  {
    id: "claude-code",
    displayName: "Claude Code",
    projectSkillsDir: ".claude/skills",
    userSkillsDir: (env, homeDir) => `${trimmedEnv(env.CLAUDE_CONFIG_DIR) ?? `${homeDir}/.claude`}/skills`,
  },
  {
    id: "codex",
    displayName: "Codex",
    projectSkillsDir: ".agents/skills",
    userSkillsDir: (env, homeDir) => `${trimmedEnv(env.CODEX_HOME) ?? `${homeDir}/.codex`}/skills`,
  },
  {
    id: "github-copilot",
    displayName: "GitHub Copilot",
    projectSkillsDir: ".agents/skills",
    userSkillsDir: (_env, homeDir) => `${homeDir}/.copilot/skills`,
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    projectSkillsDir: ".agents/skills",
    userSkillsDir: (env, homeDir) => `${trimmedEnv(env.XDG_CONFIG_HOME) ?? `${homeDir}/.config`}/opencode/skills`,
  },
  {
    // Asymmetric on purpose (ADR-0006) — the one Agent whose two Scopes use different
    // suffixes ("skills" vs. "agent/skills"), easiest to get wrong.
    id: "pi",
    displayName: "Pi",
    projectSkillsDir: ".pi/skills",
    userSkillsDir: (_env, homeDir) => `${homeDir}/.pi/agent/skills`,
  },
  {
    id: "generic",
    displayName: "Generic (.agents/skills convention)",
    projectSkillsDir: ".agents/skills",
    userSkillsDir: (env, homeDir) => `${trimmedEnv(env.XDG_CONFIG_HOME) ?? `${homeDir}/.config`}/agents/skills`,
  },
];

/**
 * Looks up one Agent's entry in {@link AGENTS}.
 *
 * @param id - The Agent to look up.
 * @returns That Agent's table entry.
 * @throws Error when `id` names no Agent in the table. Callers holding an unvalidated
 * string should narrow it against `AGENTS` first rather than relying on this.
 *
 * @example
 * ```ts
 * getAgent("pi").projectSkillsDir; // ".pi/skills"
 * ```
 */
export function getAgent(id: AgentId): AgentEntry {
  const agent = AGENTS.find((entry) => entry.id === id);
  if (!agent) throw new Error(`Unknown Agent: ${id}`);
  return agent;
}

export interface ResolveContext {
  env: Record<string, string | undefined>;
  homeDir: string;
  projectRoot: string;
}

/**
 * The directory `agentId` actually reads Skills from at `scope`.
 *
 * @param agentId - The Agent to resolve for.
 * @param scope - "project" for a directory under `ctx.projectRoot`, "user" for the
 * Agent's per-User configuration directory.
 * @param ctx - The environment, home directory, and project root to resolve against.
 * @returns A POSIX-style path — absolute at "user" Scope, and rooted at `ctx.projectRoot`
 * at "project" Scope.
 * @throws Error when `agentId` names no Agent in the table (via {@link getAgent}).
 *
 * @example
 * ```ts
 * resolveInstallDir("codex", "project", { env: {}, homeDir: "/home/dev", projectRoot: "/repo" });
 * // -> "/repo/.agents/skills"
 * ```
 */
export function resolveInstallDir(agentId: AgentId, scope: Scope, ctx: ResolveContext): string {
  const agent = getAgent(agentId);
  return scope === "project" ? `${ctx.projectRoot}/${agent.projectSkillsDir}` : agent.userSkillsDir(ctx.env, ctx.homeDir);
}

/**
 * Every Agent that reads the same directory `agentId` resolves to, `agentId` included.
 *
 * One install can serve several Agents — `codex`, `github-copilot`, `opencode`, and
 * `generic` all share `.agents/skills` at "project" Scope (ADR-0006) — and `add` names
 * them so nobody runs the command again believing there is more to do.
 *
 * @param agentId - The Agent that was actually chosen.
 * @param scope - The Scope the install is happening at.
 * @param ctx - The environment, home directory, and project root to resolve against.
 * @returns The sharing Agents' ids in table order; a single-element array when nothing
 * else resolves there.
 * @throws Error when `agentId` names no Agent in the table (via {@link getAgent}).
 *
 * @example
 * ```ts
 * agentsSharingInstallDir("codex", "project", ctx);
 * // -> ["codex", "github-copilot", "opencode", "generic"]
 * ```
 */
export function agentsSharingInstallDir(agentId: AgentId, scope: Scope, ctx: ResolveContext): AgentId[] {
  const target = resolveInstallDir(agentId, scope, ctx);
  return AGENTS.filter((entry) => resolveInstallDir(entry.id, scope, ctx) === target).map((entry) => entry.id);
}
