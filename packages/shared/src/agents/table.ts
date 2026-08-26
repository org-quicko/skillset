/**
 * `claude-code` and `codex`'s directories and environment overrides are derived from
 * `vercel-labs/skills` (MIT), `src/agents.ts` at commit
 * `dd3ca3c85581e593434546a4016fb3a7e7b7f937` (2026-08-18). See LICENSE.vercel-labs-skills
 * in this directory for the upstream copyright notice and licence text. `generic` is our
 * own addition, not upstream's — see docs/adr/0014.
 *
 * Paths are POSIX-style strings, relative to a project root or a home directory, never
 * touching `node:path` or `node:os` — this module is shared with the browser (spec,
 * "Shape"). The CLI resolves these against the real filesystem.
 */

export type AgentId = "claude-code" | "codex" | "generic";
export type Scope = "project" | "user";

export interface AgentEntry {
  id: AgentId;
  displayName: string;
  /** Relative to a project root. */
  projectSkillsDir: string;
  /**
   * The Skill directory at "user" Scope: an absolute, POSIX-style path, honouring this
   * Agent's own configuration-directory environment override where one exists.
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
    id: "generic",
    displayName: "Generic (.agents/skills convention)",
    projectSkillsDir: ".agents/skills",
    userSkillsDir: (env, homeDir) => `${trimmedEnv(env.XDG_CONFIG_HOME) ?? `${homeDir}/.config`}/agents/skills`,
  },
];

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
 * The `generic` Agent's own directory *is* the canonical install location — its whole
 * purpose is to be the shared, convention-following spot every other selected Agent
 * either already reads from directly (when it resolves to the same path, e.g. `codex` at
 * "project" Scope) or gets symlinked to (docs/adr/0014).
 */
export function resolveInstallDir(agentId: AgentId, scope: Scope, ctx: ResolveContext): string {
  const agent = getAgent(agentId);
  return scope === "project" ? `${ctx.projectRoot}/${agent.projectSkillsDir}` : agent.userSkillsDir(ctx.env, ctx.homeDir);
}

export function canonicalInstallDir(scope: Scope, ctx: ResolveContext): string {
  return resolveInstallDir("generic", scope, ctx);
}
