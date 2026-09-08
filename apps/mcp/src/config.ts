import { AGENT_IDS, type AgentId } from "@skillset/shared";

/** Where an install goes: `add_skills`'s target Scope. */
export const SCOPES = ["project", "user"] as const;
export type Scope = (typeof SCOPES)[number];

/** Diagnostics verbosity for the stderr logger. */
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const DEFAULT_SCOPE: Scope = "project";
const DEFAULT_LOG_LEVEL: LogLevel = "warn";

/** The server's fully resolved configuration: where to read from, who to install for, and how loud to be about it. */
export interface McpConfig {
  registry: string;
  scope: Scope;
  /**
   * The Agent to install for. Required for now — spec's detection ladder (ticket 51) does not
   * exist yet, so there is nothing to fall back to when this is omitted.
   */
  agentId: AgentId;
  logLevel: LogLevel;
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
 * @returns The resolved `registry`, `scope`, `agentId`, and `logLevel`.
 * @throws ConfigError if `--registry` is absent and `SKILLSET_REGISTRY` is not set, if
 * `--scope` or `--log-level` is given a value outside their accepted sets, if `--agent` is
 * absent, or if it names no Agent in the table.
 *
 * @remarks
 * `--registry` wins over `SKILLSET_REGISTRY` when both are present. There is deliberately
 * no `--token` flag and `SKILLSET_TOKEN` is never read: this server holds no credential at
 * all (reads need none, per ADR-0013). `--agent` is required for now rather than defaulted:
 * the spec's detection ladder is ticket 51, and until it exists there is nothing to fall
 * back to.
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
  if (!rawAgent) {
    throw new ConfigError("An Agent is required for now: pass --agent <id>.");
  }
  if (!isAgentId(rawAgent)) {
    throw new ConfigError(`--agent must be one of: ${AGENT_IDS.join(", ")}.`);
  }

  return { registry, scope: rawScope, agentId: rawAgent, logLevel: rawLogLevel };
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
