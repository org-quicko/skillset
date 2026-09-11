import { AGENT_IDS, type AgentId } from "@in-org-quicko/skillset-shared";

/** Where an install goes: `add_skills`'s target Scope. */
export const SCOPES = ["project", "user"] as const;
export type Scope = (typeof SCOPES)[number];

/** Diagnostics verbosity for the stderr logger. */
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const DEFAULT_SCOPE: Scope = "project";
const DEFAULT_LOG_LEVEL: LogLevel = "warn";

/**
 * Whether a Token came from the command line rather than the environment.
 *
 * `--token <secret>` puts the secret in the process list, where every other
 * process on the machine can read it, and in the `.mcp.json` that configures
 * this server — which is usually checked in (ISSUE-22). `SKILLSET_TOKEN` is
 * the documented way, and this is what lets the server say so out loud when
 * the flag is used instead.
 */
export type TokenSource = "flag" | "environment" | "none";

/** The server's fully resolved configuration: where to read from, who to install for, and how loud to be about it. */
export interface McpConfig {
  registry: string;
  scope: Scope;
  /**
   * The `--agent` override, or `undefined` to let the server detect the Agent (spec,
   * "Detecting the Agent"). An escape hatch for a wrong or missing detection — it stays out of
   * the ordinary setup snippet.
   */
  agentId: AgentId | undefined;
  logLevel: LogLevel;
  /**
   * The writer's Token, or `undefined` when none was configured. Absent for every tool but
   * `publish_skill` (ADR-0035) — reads still send no `authorization` header at all (ADR-0013).
   */
  token: string | undefined;
  /** Where `token` came from — see {@link TokenSource}. */
  tokenSource: TokenSource;
}

/** Raised by {@link parseConfig} when `argv`/`env` cannot be turned into a valid {@link McpConfig}. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Reads one `--flag value` pair out of an argv array.
 *
 * @remarks
 * Hand-rolled rather than a library: this workspace deliberately carries no
 * argument-parsing dependency (see the ADR this ticket adds), since `npx`
 * fetches this package fresh on every cold start.
 */
function readFlag(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new ConfigError(`${flag} needs a value.`);
  }
  return value;
}

/**
 * Parses this server's configuration from its command-line flags and environment.
 *
 * @param argv - The flags to parse, e.g. `process.argv.slice(2)`.
 * @param env - The environment to read fallbacks from, e.g. `process.env`.
 * @returns The resolved `registry`, `scope`, `agentId` (`undefined` unless `--agent` was
 * given), `logLevel`, `token` (`undefined` unless `--token` or `SKILLSET_TOKEN` was given), and
 * `tokenSource`, which records which of the two it came from.
 * @throws ConfigError if `--registry` is absent and `SKILLSET_REGISTRY` is not set, if
 * `--scope` or `--log-level` is given a value outside their accepted sets, or if `--agent` is
 * given but names no Agent in the table.
 *
 * @remarks
 * `--registry` wins over `SKILLSET_REGISTRY` when both are present, and `--token` wins over
 * `SKILLSET_TOKEN` the same way. Every tool but `publish_skill` still sends no `authorization`
 * header at all (ADR-0013) — a configured Token is read but otherwise ignored unless that one
 * tool is called (ADR-0035 reopens ADR-0033's "holds no credential" specifically for
 * publishing, which needs a writer Token; reads still need none). `--agent` is optional — when
 * omitted, the server detects the Agent (spec, "Detecting the Agent"); the flag only overrides
 * that.
 *
 * @example
 * ```ts
 * const config = parseConfig(process.argv.slice(2), process.env);
 * ```
 */
export function parseConfig(argv: readonly string[], env: NodeJS.ProcessEnv): McpConfig {
  const registry = readFlag(argv, "--registry") ?? env.SKILLSET_REGISTRY;
  if (!registry) {
    throw new ConfigError("A Registry is required: pass --registry <url> or set SKILLSET_REGISTRY.");
  }

  const rawScope = readFlag(argv, "--scope") ?? DEFAULT_SCOPE;
  if (!isScope(rawScope)) {
    throw new ConfigError(`--scope must be one of: ${SCOPES.join(", ")}.`);
  }

  const rawLogLevel = readFlag(argv, "--log-level") ?? DEFAULT_LOG_LEVEL;
  if (!isLogLevel(rawLogLevel)) {
    throw new ConfigError(`--log-level must be one of: ${LOG_LEVELS.join(", ")}.`);
  }

  const rawAgent = readFlag(argv, "--agent");
  if (rawAgent !== undefined && !isAgentId(rawAgent)) {
    throw new ConfigError(`--agent must be one of: ${AGENT_IDS.join(", ")}.`);
  }

  const tokenFlag = readFlag(argv, "--token");
  const token = tokenFlag ?? env.SKILLSET_TOKEN;
  const tokenSource: TokenSource = tokenFlag ? "flag" : token ? "environment" : "none";

  return { registry, scope: rawScope, agentId: rawAgent, logLevel: rawLogLevel, token, tokenSource };
}

function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

function isAgentId(value: string): value is AgentId {
  return (AGENT_IDS as readonly string[]).includes(value);
}
