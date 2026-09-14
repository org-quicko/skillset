/**
 * The Agent → skills-directory table (ADR-0031): a hand-curated list of widely-used coding
 * Agents and the directory each reads a Skill's files from, at project and user Scope. Every
 * row is verified against that Agent's own public documentation — an unverified row is worse
 * than an absent one, because it writes to a directory nothing reads and the Skill never loads
 * (ADR-0006's original principle, restored).
 *
 * This module is shared with the browser (spec, "Shape"), so paths are POSIX-style strings
 * resolved from an explicit `env`/`homeDir`, never `node:os` or `node:path`.
 *
 * How an install lands (ADR-0022, unaffected by ADR-0031): the Skill's files are always
 * written to the canonical `.agents/skills/<name>` directory; an Agent whose own directory is
 * elsewhere (`.claude/skills`, `.windsurf/skills`, …) gets a symlink there pointing back at the
 * canonical copy.
 */

export type Scope = "project" | "user";

type Env = Record<string, string | undefined>;

/** The one directory every Skill's files are written to; several Agents read it directly. */
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
  /**
   * Environment variables whose presence (any one, non-blank) marks this Agent as the one
   * currently running — the "environment" rung of {@link detectAgent}'s ladder. Absent for an
   * Agent with no known marker.
   *
   * @remarks
   * Every entry is cross-checked against Vercel's `@vercel/detect-agent` `agents.json`
   * (https://github.com/vercel/detect-agent) and the Agent's own documentation. An unverified
   * marker is worse than an absent one — it resolves detection to the wrong Agent silently
   * (ADR-0031's principle for this table, applied to markers). Markers that need a filesystem
   * probe (`devin`) or a value match rather than mere presence (`kiro-cli`) are deferred.
   */
  envMarkers?: readonly string[];
}

/** Strips a value to `undefined` when it is missing or holds nothing but whitespace. */
function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** A path fixed under the User's home directory: `~/<suffix>`. */
const homeRelative = (suffix: string) => (_env: Env, homeDir: string): string => `${homeDir}/${suffix}`;

/** A path under `$XDG_CONFIG_HOME`, falling back to `~/.config` when that variable is unset. */
const xdgConfigRelative = (suffix: string) => (env: Env, homeDir: string): string =>
  `${nonBlank(env.XDG_CONFIG_HOME) ?? `${homeDir}/.config`}/${suffix}`;

/** A path under `$<envKey>` when set, otherwise under `~/<fallbackDir>`. */
const envOrHomeRelative = (envKey: string, fallbackDir: string, suffix: string) => (env: Env, homeDir: string): string =>
  `${nonBlank(env[envKey]) ?? `${homeDir}/${fallbackDir}`}/${suffix}`;

/**
 * Every Agent `skillset add` can install for, alphabetically — the order the searchable
 * prompt lists them in.
 *
 * @remarks
 * Deliberately a short list of Agents in wide, current use rather than an exhaustive one:
 * growing it means verifying a new Agent's own directory convention against its own
 * documentation, not diffing against someone else's release (ADR-0031).
 */
const AGENT_TABLE = [
  { id: "amp", displayName: "Amp", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: xdgConfigRelative("agents/skills") },
  { id: "augment", displayName: "Augment", projectSkillsDir: ".augment/skills", userSkillsDir: homeRelative(".augment/skills"), envMarkers: ["AUGMENT_AGENT"] },
  { id: "claude-code", displayName: "Claude Code", projectSkillsDir: ".claude/skills", userSkillsDir: envOrHomeRelative("CLAUDE_CONFIG_DIR", ".claude", "skills"), envMarkers: ["CLAUDECODE", "CLAUDE_CODE"] },
  { id: "cline", displayName: "Cline", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: homeRelative(".agents/skills"), envMarkers: ["CLINE_ACTIVE"] },
  { id: "codex", displayName: "Codex", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: envOrHomeRelative("CODEX_HOME", ".codex", "skills"), envMarkers: ["CODEX_SANDBOX", "CODEX_THREAD_ID", "CODEX_SANDBOX_NETWORK_DISABLED"] },
  { id: "continue", displayName: "Continue", projectSkillsDir: ".continue/skills", userSkillsDir: homeRelative(".continue/skills") },
  { id: "cursor", displayName: "Cursor", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: homeRelative(".cursor/skills"), envMarkers: ["CURSOR_TRACE_ID", "CURSOR_AGENT"] },
  { id: "devin", displayName: "Devin for Terminal", projectSkillsDir: ".devin/skills", userSkillsDir: xdgConfigRelative("devin/skills") },
  { id: "droid", displayName: "Droid", projectSkillsDir: ".factory/skills", userSkillsDir: homeRelative(".factory/skills") },
  { id: "gemini-cli", displayName: "Gemini CLI", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: homeRelative(".gemini/skills"), envMarkers: ["GEMINI_CLI"] },
  { id: "github-copilot", displayName: "GitHub Copilot", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: homeRelative(".copilot/skills") },
  { id: "goose", displayName: "Goose", projectSkillsDir: ".goose/skills", userSkillsDir: xdgConfigRelative("goose/skills"), envMarkers: ["GOOSE_PROVIDER"] },
  { id: "grok", displayName: "Grok Build", projectSkillsDir: ".grok/skills", userSkillsDir: envOrHomeRelative("GROK_HOME", ".grok", "skills"), envMarkers: ["GROK_PLUGIN_ROOT", "GROK_PLUGIN_DATA"] },
  { id: "junie", displayName: "Junie", projectSkillsDir: ".junie/skills", userSkillsDir: homeRelative(".junie/skills"), envMarkers: ["JUNIE_DATA", "JUNIE_SHIM_PATH"] },
  { id: "kilo", displayName: "Kilo Code", projectSkillsDir: ".kilocode/skills", userSkillsDir: homeRelative(".kilocode/skills") },
  { id: "kiro-cli", displayName: "Kiro CLI", projectSkillsDir: ".kiro/skills", userSkillsDir: homeRelative(".kiro/skills") },
  { id: "opencode", displayName: "OpenCode", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: xdgConfigRelative("opencode/skills"), envMarkers: ["OPENCODE", "OPENCODE_CLIENT"] },
  { id: "openhands", displayName: "OpenHands", projectSkillsDir: ".openhands/skills", userSkillsDir: homeRelative(".openhands/skills") },
  { id: "qwen-code", displayName: "Qwen Code", projectSkillsDir: ".qwen/skills", userSkillsDir: homeRelative(".qwen/skills") },
  { id: "replit", displayName: "Replit", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: xdgConfigRelative("agents/skills"), envMarkers: ["REPL_ID"] },
  { id: "roo", displayName: "Roo Code", projectSkillsDir: ".roo/skills", userSkillsDir: homeRelative(".roo/skills") },
  { id: "trae", displayName: "Trae", projectSkillsDir: ".trae/skills", userSkillsDir: homeRelative(".trae/skills") },
  { id: "warp", displayName: "Warp", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: homeRelative(".agents/skills") },
  { id: "windsurf", displayName: "Windsurf", projectSkillsDir: ".windsurf/skills", userSkillsDir: homeRelative(".codeium/windsurf/skills") },
  { id: "zed", displayName: "Zed", projectSkillsDir: CANONICAL_SKILLS_DIR, userSkillsDir: homeRelative(".agents/skills") },
] as const;

export type AgentId = (typeof AGENT_TABLE)[number]["id"];

export const AGENTS: readonly AgentEntry[] = AGENT_TABLE;

/** Every Agent's id, in {@link AGENTS}'s order — the one place this projection is derived. */
export const AGENT_IDS: readonly AgentId[] = AGENTS.map((agent) => agent.id);

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
 * getAgent("windsurf").projectSkillsDir; // ".windsurf/skills"
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
 * `.agents/skills`; `false` for `claude-code`, `windsurf`, and the rest.
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
 * user-level location.
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
 * Several Agents share `.agents/skills` outright (ADR-0022's canonical directory) —
 * installing once already serves every Agent this returns, which is what lets `add` say so
 * instead of leaving the next run to discover it (ticket 09).
 *
 * @param agentId - The Agent just installed for.
 * @param scope - The Scope it was installed at.
 * @param ctx - The environment, home directory, and project root to resolve against.
 * @returns The ids of every other Agent whose own directory at `scope` resolves to the same
 * path as `agentId`'s, or `[]` if none — including when `agentId` has no directory at `scope`.
 * @example
 * ```ts
 * agentsSharingDirectory("cline", "project", { env: {}, homeDir: "/home/dev", projectRoot: "/repo" });
 * // -> ["amp", "codex", ..., "warp", "zed"] — every other Agent reading .agents/skills
 * ```
 */
export function agentsSharingDirectory(agentId: AgentId, scope: Scope, ctx: ResolveContext): AgentId[] {
  const target = agentSkillsDir(agentId, scope, ctx);
  if (target === null) return [];
  return AGENTS.filter((agent) => agent.id !== agentId && agentSkillsDir(agent.id, scope, ctx) === target).map(
    (agent) => agent.id,
  );
}

/**
 * Every non-universal Agent paired with the project-Scope directory it reads Skills from — the
 * set a caller stats on disk to answer the "project-directory" rung of the detection ladder
 * (see `detectAgent`).
 *
 * @param ctx - The environment, home directory, and project root to resolve paths against.
 * @returns One `{ agentId, dir }` per Agent whose `projectSkillsDir` is *not* the canonical
 * `.agents/skills` — the universal Agents are omitted because a directory shared by ten Agents
 * identifies none of them.
 *
 * @remarks
 * Pure and string-only: this module is bundled for the browser, so the caller — not this
 * function — is the one that touches the filesystem.
 *
 * @example
 * ```ts
 * nonUniversalProjectSkillsDirs({ env: {}, homeDir: "/home/dev", projectRoot: "/repo" })
 *   .find((e) => e.agentId === "claude-code"); // { agentId: "claude-code", dir: "/repo/.claude/skills" }
 * ```
 */
export function nonUniversalProjectSkillsDirs(ctx: ResolveContext): { agentId: AgentId; dir: string }[] {
  return AGENTS.filter((agent) => !isUniversalAgent(agent.id)).map((agent) => ({
    agentId: agent.id,
    // Non-universal Agents always have a project directory, so this is never null.
    dir: agentSkillsDir(agent.id, "project", ctx) as string,
  }));
}
