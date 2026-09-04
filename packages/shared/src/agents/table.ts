/**
 * The Agent → skills-directory table, derived from `vercel-labs/skills` (MIT),
 * `src/agents.ts` at commit `435076e78988e1e6ec40d00b0b1d76bdbbc5419a` (v1.5.23,
 * 2026-08-18). See LICENSE.vercel-labs-skills in this directory for the upstream
 * copyright notice and licence text.
 *
 * Adapted for our use: this module is shared with the browser (spec, "Shape"), so paths
 * are POSIX-style strings resolved from an explicit `env`/`homeDir`, never `node:os` or
 * `node:path`. Upstream's `detectInstalled` (filesystem probing), `showInUniversalPrompt`
 * flags, Eve subagents, and the `universal` pseudo-Agent are all dropped — `skillreg add`
 * offers every Agent through a searchable prompt rather than narrowing to installed ones
 * (ADR-0022).
 *
 * How an install lands (ADR-0022): the Skill's files are always written to the canonical
 * `.agents/skills/<name>` directory; an Agent whose own directory is elsewhere
 * (`.claude/skills`, `.pi/skills`, …) gets a symlink there pointing back at the canonical
 * copy.
 */

export type Scope = "project" | "user";

type Env = Record<string, string | undefined>;

/** The one directory every Skill's files are written to; dozens of Agents read it directly. */
export const CANONICAL_SKILLS_DIR = ".agents/skills";

export interface AgentEntry {
  id: AgentId;
  displayName: string;
  /** The directory this Agent reads Skills from, relative to a project root. */
  projectSkillsDir: string;
  /**
   * This Agent's Skill directory at "user" Scope — an absolute, POSIX-style path, or
   * `null` when the Agent has no user-level location (it can only be installed for
   * per-project).
   *
   * @param env - The process environment, read for this Agent's own
   * configuration-directory override where it has one. A blank or whitespace-only value
   * counts as unset.
   * @param homeDir - The User's home directory, used when no override applies.
   */
  userSkillsDir(env: Env, homeDir: string): string | null;
}

function trimmedEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** `~/<suffix>` */
const inHome = (suffix: string) => (_env: Env, homeDir: string): string => `${homeDir}/${suffix}`;

/** `$XDG_CONFIG_HOME/<suffix>`, or `~/.config/<suffix>` when it is unset. */
const inXdgConfig = (suffix: string) => (env: Env, homeDir: string): string =>
  `${trimmedEnv(env.XDG_CONFIG_HOME) ?? `${homeDir}/.config`}/${suffix}`;

/** `$<key>/<suffix>`, or `~/<fallbackDir>/<suffix>` when `$<key>` is unset. */
const inEnvHome = (key: string, fallbackDir: string, suffix: string) => (env: Env, homeDir: string): string =>
  `${trimmedEnv(env[key]) ?? `${homeDir}/${fallbackDir}`}/${suffix}`;

/** The Agent has no user-Scope directory. */
const noUserDir = () => null;

const RAW_AGENTS = [
  { id: "adal", displayName: "AdaL", projectSkillsDir: ".adal/skills", userSkillsDir: inHome(".adal/skills") },
  { id: "aider-desk", displayName: "AiderDesk", projectSkillsDir: ".aider-desk/skills", userSkillsDir: inHome(".aider-desk/skills") },
  { id: "amp", displayName: "Amp", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: inXdgConfig("agents/skills") },
  { id: "antigravity", displayName: "Antigravity", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: inHome(".gemini/antigravity/skills") },
  { id: "antigravity-cli", displayName: "Antigravity CLI", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: inHome(".gemini/antigravity-cli/skills") },
  { id: "astrbot", displayName: "AstrBot", projectSkillsDir: "data/skills", userSkillsDir: inHome(".astrbot/data/skills") },
  { id: "augment", displayName: "Augment", projectSkillsDir: ".augment/skills", userSkillsDir: inHome(".augment/skills") },
  { id: "autohand-code", displayName: "Autohand Code CLI", projectSkillsDir: ".autohand/skills", userSkillsDir: inEnvHome("AUTOHAND_HOME", ".autohand", "skills") },
  { id: "bob", displayName: "IBM Bob", projectSkillsDir: ".bob/skills", userSkillsDir: inHome(".bob/skills") },
  { id: "claude-code", displayName: "Claude Code", projectSkillsDir: ".claude/skills", userSkillsDir: inEnvHome("CLAUDE_CONFIG_DIR", ".claude", "skills") },
  { id: "cline", displayName: "Cline", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: inHome(".agents/skills") },
  { id: "codearts-agent", displayName: "CodeArts Agent", projectSkillsDir: ".codeartsdoer/skills", userSkillsDir: inHome(".codeartsdoer/skills") },
  { id: "codebuddy", displayName: "CodeBuddy", projectSkillsDir: ".codebuddy/skills", userSkillsDir: inHome(".codebuddy/skills") },
  { id: "codemaker", displayName: "Codemaker", projectSkillsDir: ".codemaker/skills", userSkillsDir: inHome(".codemaker/skills") },
  { id: "codestudio", displayName: "Code Studio", projectSkillsDir: ".codestudio/skills", userSkillsDir: inHome(".codestudio/skills") },
  { id: "codex", displayName: "Codex", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: inEnvHome("CODEX_HOME", ".codex", "skills") },
  { id: "command-code", displayName: "Command Code", projectSkillsDir: ".commandcode/skills", userSkillsDir: inHome(".commandcode/skills") },
  { id: "continue", displayName: "Continue", projectSkillsDir: ".continue/skills", userSkillsDir: inHome(".continue/skills") },
  { id: "cortex", displayName: "Cortex Code", projectSkillsDir: ".cortex/skills", userSkillsDir: inHome(".snowflake/cortex/skills") },
  { id: "crush", displayName: "Crush", projectSkillsDir: ".crush/skills", userSkillsDir: inHome(".config/crush/skills") },
  { id: "cursor", displayName: "Cursor", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: inHome(".cursor/skills") },
  { id: "deepagents", displayName: "Deep Agents", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: inHome(".deepagents/agent/skills") },
  { id: "devin", displayName: "Devin for Terminal", projectSkillsDir: ".devin/skills", userSkillsDir: inXdgConfig("devin/skills") },
  { id: "dexto", displayName: "Dexto", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: inHome(".agents/skills") },
  { id: "droid", displayName: "Droid", projectSkillsDir: ".factory/skills", userSkillsDir: inHome(".factory/skills") },
  { id: "eve", displayName: "Eve", projectSkillsDir: "agent/skills", userSkillsDir: noUserDir },
  { id: "firebender", displayName: "Firebender", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: inHome(".firebender/skills") },
  { id: "forgecode", displayName: "ForgeCode", projectSkillsDir: ".forge/skills", userSkillsDir: inHome(".forge/skills") },
  { id: "gemini-cli", displayName: "Gemini CLI", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: inHome(".gemini/skills") },
  { id: "github-copilot", displayName: "GitHub Copilot", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: inHome(".copilot/skills") },
  { id: "goose", displayName: "Goose", projectSkillsDir: ".goose/skills", userSkillsDir: inXdgConfig("goose/skills") },
  { id: "grok", displayName: "Grok Build", projectSkillsDir: ".grok/skills", userSkillsDir: inEnvHome("GROK_HOME", ".grok", "skills") },
  { id: "hermes-agent", displayName: "Hermes Agent", projectSkillsDir: ".hermes/skills", userSkillsDir: inEnvHome("HERMES_HOME", ".hermes", "skills") },
  { id: "iflow-cli", displayName: "iFlow CLI", projectSkillsDir: ".iflow/skills", userSkillsDir: inHome(".iflow/skills") },
  { id: "inference-sh", displayName: "inference.sh", projectSkillsDir: ".inferencesh/skills", userSkillsDir: inHome(".inferencesh/skills") },
  { id: "jazz", displayName: "Jazz", projectSkillsDir: ".jazz/skills", userSkillsDir: inHome(".jazz/skills") },
  { id: "junie", displayName: "Junie", projectSkillsDir: ".junie/skills", userSkillsDir: inHome(".junie/skills") },
  { id: "kilo", displayName: "Kilo Code", projectSkillsDir: ".kilocode/skills", userSkillsDir: inHome(".kilocode/skills") },
  { id: "kimchi", displayName: "Kimchi", projectSkillsDir: ".kimchi/skills", userSkillsDir: inHome(".config/kimchi/harness/skills") },
  { id: "kimi-code-cli", displayName: "Kimi Code CLI", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: inHome(".agents/skills") },
  { id: "kiro-cli", displayName: "Kiro CLI", projectSkillsDir: ".kiro/skills", userSkillsDir: inHome(".kiro/skills") },
  { id: "kode", displayName: "Kode", projectSkillsDir: ".kode/skills", userSkillsDir: inHome(".kode/skills") },
  { id: "lingma", displayName: "Lingma", projectSkillsDir: ".lingma/skills", userSkillsDir: inHome(".lingma/skills") },
  { id: "loaf", displayName: "Loaf", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: inHome(".agents/skills") },
  { id: "mcpjam", displayName: "MCPJam", projectSkillsDir: ".mcpjam/skills", userSkillsDir: inHome(".mcpjam/skills") },
  { id: "minimax-code", displayName: "MiniMax Code", projectSkillsDir: ".minimax/skills", userSkillsDir: inHome(".minimax/skills") },
  { id: "mistral-vibe", displayName: "Mistral Vibe", projectSkillsDir: ".vibe/skills", userSkillsDir: inEnvHome("VIBE_HOME", ".vibe", "skills") },
  { id: "moxby", displayName: "Moxby", projectSkillsDir: ".moxby/skills", userSkillsDir: inHome(".moxby/skills") },
  { id: "mux", displayName: "Mux", projectSkillsDir: ".mux/skills", userSkillsDir: inHome(".mux/skills") },
  { id: "neovate", displayName: "Neovate", projectSkillsDir: ".neovate/skills", userSkillsDir: inHome(".neovate/skills") },
  { id: "ona", displayName: "Ona", projectSkillsDir: ".ona/skills", userSkillsDir: inHome(".ona/skills") },
  { id: "openclaw", displayName: "OpenClaw", projectSkillsDir: "skills", userSkillsDir: inHome(".openclaw/skills") },
  { id: "opencode", displayName: "OpenCode", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: inXdgConfig("opencode/skills") },
  { id: "openhands", displayName: "OpenHands", projectSkillsDir: ".openhands/skills", userSkillsDir: inHome(".openhands/skills") },
  { id: "pi", displayName: "Pi", projectSkillsDir: ".pi/skills", userSkillsDir: inHome(".pi/agent/skills") },
  { id: "pochi", displayName: "Pochi", projectSkillsDir: ".pochi/skills", userSkillsDir: inHome(".pochi/skills") },
  { id: "posit-assistant", displayName: "Posit Assistant", projectSkillsDir: ".posit/assistant/skills", userSkillsDir: inHome(".posit/assistant/skills") },
  { id: "promptscript", displayName: "PromptScript", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: noUserDir },
  { id: "qoder", displayName: "Qoder", projectSkillsDir: ".qoder/skills", userSkillsDir: inHome(".qoder/skills") },
  { id: "qoder-cn", displayName: "Qoder CN", projectSkillsDir: ".qoder/skills", userSkillsDir: inHome(".qoder-cn/skills") },
  { id: "qwen-code", displayName: "Qwen Code", projectSkillsDir: ".qwen/skills", userSkillsDir: inHome(".qwen/skills") },
  { id: "reasonix", displayName: "Reasonix", projectSkillsDir: ".reasonix/skills", userSkillsDir: inHome(".reasonix/skills") },
  { id: "replit", displayName: "Replit", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: inXdgConfig("agents/skills") },
  { id: "roo", displayName: "Roo Code", projectSkillsDir: ".roo/skills", userSkillsDir: inHome(".roo/skills") },
  { id: "rovodev", displayName: "Rovo Dev", projectSkillsDir: ".rovodev/skills", userSkillsDir: inHome(".rovodev/skills") },
  { id: "tabnine-cli", displayName: "Tabnine CLI", projectSkillsDir: ".tabnine/agent/skills", userSkillsDir: inHome(".tabnine/agent/skills") },
  { id: "terramind", displayName: "Terramind", projectSkillsDir: ".terramind/skills", userSkillsDir: inHome(".terramind/skills") },
  { id: "tinycloud", displayName: "Tinycloud", projectSkillsDir: ".tinycloud/skills", userSkillsDir: inHome(".tinycloud/skills") },
  { id: "trae", displayName: "Trae", projectSkillsDir: ".trae/skills", userSkillsDir: inHome(".trae/skills") },
  { id: "trae-cn", displayName: "Trae CN", projectSkillsDir: ".trae/skills", userSkillsDir: inHome(".trae-cn/skills") },
  { id: "warp", displayName: "Warp", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: inHome(".agents/skills") },
  { id: "windsurf", displayName: "Windsurf", projectSkillsDir: ".windsurf/skills", userSkillsDir: inHome(".codeium/windsurf/skills") },
  { id: "zcode", displayName: "ZCode", projectSkillsDir: ".zcode/skills", userSkillsDir: inHome(".zcode/skills") },
  { id: "zed", displayName: "Zed", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: inHome(".agents/skills") },
  { id: "zencoder", displayName: "Zencoder", projectSkillsDir: ".zencoder/skills", userSkillsDir: inHome(".zencoder/skills") },
  { id: "zenflow", displayName: "Zenflow", projectSkillsDir: ".zencoder/skills", userSkillsDir: inHome(".zencoder/skills") },
] as const;

export type AgentId = (typeof RAW_AGENTS)[number]["id"];

/** Every Agent `skillreg add` can install for, in the order the searchable prompt lists them. */
export const AGENTS: readonly AgentEntry[] = RAW_AGENTS;

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

/**
 * Whether this Agent reads the canonical `.agents/skills` directory directly, so an
 * install needs no symlink into an Agent-specific directory.
 *
 * @param id - The Agent to check.
 * @returns `true` for Agents like `codex` and `cursor` whose project directory *is*
 * `.agents/skills`; `false` for `claude-code`, `pi`, and the rest.
 * @throws Error when `id` names no Agent (via {@link getAgent}).
 *
 * @example
 * ```ts
 * isUniversalAgent("codex");       // true
 * isUniversalAgent("claude-code"); // false
 * ```
 */
export function isUniversalAgent(id: AgentId): boolean {
  return getAgent(id).projectSkillsDir === CANONICAL_SKILLS_DIR;
}

export interface ResolveContext {
  env: Env;
  homeDir: string;
  projectRoot: string;
}

/**
 * The canonical directory a Skill's files are written to at `scope`, before any
 * Agent-specific symlink.
 *
 * @param scope - "project" for `<projectRoot>/.agents/skills`, "user" for
 * `<homeDir>/.agents/skills`.
 * @param ctx - The home directory and project root to resolve against.
 * @returns A POSIX-style path — rooted at `ctx.projectRoot` at "project" Scope, absolute
 * at "user" Scope.
 *
 * @example
 * ```ts
 * canonicalSkillsDir("project", { env: {}, homeDir: "/home/dev", projectRoot: "/repo" });
 * // -> "/repo/.agents/skills"
 * ```
 */
export function canonicalSkillsDir(scope: Scope, ctx: ResolveContext): string {
  return scope === "project" ? `${ctx.projectRoot}/${CANONICAL_SKILLS_DIR}` : `${ctx.homeDir}/${CANONICAL_SKILLS_DIR}`;
}

/**
 * The directory `agentId` actually reads Skills from at `scope`.
 *
 * @param agentId - The Agent to resolve for.
 * @param scope - "project" for a directory under `ctx.projectRoot`, "user" for the
 * Agent's per-User configuration directory.
 * @param ctx - The environment, home directory, and project root to resolve against.
 * @returns A POSIX-style path, or `null` when `scope` is "user" and the Agent has no
 * user-level location (`eve`, `promptscript`).
 * @throws Error when `agentId` names no Agent in the table (via {@link getAgent}).
 *
 * @example
 * ```ts
 * agentSkillsDir("claude-code", "project", { env: {}, homeDir: "/home/dev", projectRoot: "/repo" });
 * // -> "/repo/.claude/skills"
 * ```
 */
export function agentSkillsDir(agentId: AgentId, scope: Scope, ctx: ResolveContext): string | null {
  const agent = getAgent(agentId);
  return scope === "project" ? `${ctx.projectRoot}/${agent.projectSkillsDir}` : agent.userSkillsDir(ctx.env, ctx.homeDir);
}

/**
 * Every other Agent that reads Skills from the same directory as `agentId` at `scope`.
 *
 * @remarks
 * Dozens of Agents share `.agents/skills` outright (ADR-0022's canonical directory), and a
 * few coincidentally point at the same directory of their own (`qoder`/`qoder-cn`,
 * `trae`/`trae-cn`, `zencoder`/`zenflow`) — installing once already serves every Agent this
 * returns, which is what lets `add` say so instead of leaving the next run to discover it
 * (ticket 09).
 *
 * @param agentId - The Agent just installed for.
 * @param scope - The Scope it was installed at.
 * @param ctx - The environment, home directory, and project root to resolve against.
 * @returns The ids of every other Agent whose own directory at `scope` resolves to the same
 * path as `agentId`'s, or `[]` if none — including when `agentId` has no directory at `scope`.
 * @example
 * ```ts
 * agentsSharingDirectory("cline", "project", { env: {}, homeDir: "/home/dev", projectRoot: "/repo" });
 * // -> ["amp", "antigravity", ..., "warp", "zed"] — every other Agent reading .agents/skills
 * ```
 */
export function agentsSharingDirectory(agentId: AgentId, scope: Scope, ctx: ResolveContext): AgentId[] {
  const target = agentSkillsDir(agentId, scope, ctx);
  if (target === null) return [];
  return AGENTS.filter((agent) => agent.id !== agentId && agentSkillsDir(agent.id, scope, ctx) === target).map(
    (agent) => agent.id,
  );
}
