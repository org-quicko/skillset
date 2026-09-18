import { existsSync } from "node:fs";
import {
  AGENT_IDS,
  AGENTS,
  detectAgent,
  extractSkillFiles,
  nonUniversalProjectSkillsDirs,
  SkillSchema,
  type AgentId,
  type Scope,
} from "@in-org-quicko/skillset-shared";
import { installSkill, type WriteReport } from "@in-org-quicko/skillset-installer";
import { rethrowValidationError } from "../errors.js";
import { downloadBinary, registryFetch } from "../http.js";
import { openReadClient, type SessionDeps } from "../session.js";

/** One selectable Agent, as the searchable prompt shows it. */
export interface AgentChoice {
  id: AgentId;
  displayName: string;
}

export interface AddDeps extends SessionDeps {
  cwd: string;
  homeDir: string;
  /** Whether a terminal is attached — decides whether a missing `--agent`/`--scope` can be prompted for. */
  isTTY: boolean;
  /**
   * Asks the User to choose one value from `choices`. Called only when `isTTY` is true and
   * the matching flag was omitted.
   */
  promptChoice(question: string, choices: readonly string[]): Promise<string>;
  /**
   * Asks the User to pick one Agent from the full list, searchably. Called only when
   * `isTTY` is true and `--agent` was omitted. The result is validated against the table.
   */
  promptAgent(choices: readonly AgentChoice[]): Promise<string>;
}

export interface AddOptions {
  name: string;
  agent?: string;
  scope?: string;
  /** `--copy`: write the Skill into the Agent's own directory rather than symlinking to `.agents/skills`. */
  copy?: boolean;
}

const SCOPES: readonly Scope[] = ["project", "user"];

/** The full Agent list handed to the searchable prompt. */
export const AGENT_CHOICES: readonly AgentChoice[] = AGENTS.map((agent) => ({ id: agent.id, displayName: agent.displayName }));

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

/** Narrows a flag or prompt answer to one of a fixed list, naming the whole list when it isn't. */
function parseChoice<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!isOneOf(value, allowed)) {
    throw new Error(`Unknown ${label} "${value}" — choose from: ${allowed.join(", ")}.`);
  }
  return value;
}

const parseScope = (value: string): Scope => parseChoice(value, SCOPES, "scope");
const parseAgentId = (value: string): AgentId => parseChoice(value, AGENT_IDS, "Agent");

/**
 * Detects which Agent to install for from the environment and the project's Agent
 * directories — the non-TTY path, where there is no prompt and `--agent` was not given.
 *
 * @param deps - Supplies the environment, project root, and home directory to resolve and
 * stat Agent directories against.
 * @returns The detected {@link AgentId}, or `null` when nothing resolved one — then the
 * install goes to `.agents/skills` and links nothing.
 */
function detectAgentId(deps: Pick<AddDeps, "env" | "cwd" | "homeDir">): AgentId | null {
  const resolveCtx = { env: deps.env, homeDir: deps.homeDir, projectRoot: deps.cwd };
  const agentDirsPresent = nonUniversalProjectSkillsDirs(resolveCtx)
    .filter(({ dir }) => existsSync(dir))
    .map(({ agentId }) => agentId);
  return detectAgent({ env: deps.env, agentDirsPresent }).agentId;
}

/**
 * Downloads a Skill and installs it, always into the canonical `.agents/skills` directory,
 * symlinking the chosen Agent's own directory to it where they differ (ADR-0022).
 *
 * @param deps - The fetch implementation, config-file path, environment, project root,
 * home directory, whether a terminal is attached, and how to prompt when a flag is missing.
 * @param options - The Skill's name, plus `--agent`, `--scope`, and `--copy` when given.
 * @returns Where the Skill's files were written, the Agent chosen, and how its directory
 * was linked.
 * @throws Error when no Registry is configured; when `--scope` is missing and no terminal is
 * attached, so there is nothing to prompt and nothing to default to; when `--agent` or
 * `--scope` names something unknown; or, naming the rule, when the downloaded Artifact fails
 * inspection.
 * @throws ApiError when the Registry has no Skill by that name, or refuses the download.
 * @throws RegistryUnreachableError when the Registry cannot be reached.
 *
 * @remarks
 * Reads need no Token (ADR-0013), so this works against a Registry the User has never
 * logged in to. Everything that can fail without the network — the terminal check and both
 * flags — is checked first, matching publish's local-validation-first behaviour. The
 * Artifact is inspected before a single byte is written, because this is the only place a
 * hostile one is stopped (ADR-0001). When `--agent` is omitted and no terminal is attached,
 * the Agent is detected from the environment and the project's Agent directories (the same
 * ladder the MCP server uses); an unresolved detection installs into `.agents/skills` and
 * links nothing.
 *
 * @example
 * ```ts
 * await runAdd(deps, { name: "code-review", agent: "claude-code", scope: "project" });
 * ```
 */
export async function runAdd(deps: AddDeps, options: AddOptions): Promise<WriteReport> {
  const client = await openReadClient(deps);

  if (!options.scope && !deps.isTTY) {
    throw new Error("Not a terminal — pass --scope.");
  }

  const flagScope = options.scope ? parseScope(options.scope) : null;
  const flagAgent = options.agent ? parseAgentId(options.agent) : null;

  const skill = await registryFetch(client, `/resources/skill/by-name/${encodeURIComponent(options.name)}`, SkillSchema);
  const bytes = await downloadBinary(client, `/resources/${skill.id}/artifact?source=cli`);

  let files;
  try {
    files = extractSkillFiles(bytes);
  } catch (error) {
    rethrowValidationError(error);
  }

  // Agent before Scope, matching the ticket's prompt order. With no flag and no terminal, the
  // Agent is detected rather than prompted for.
  const agentId: AgentId | null = flagAgent ?? (deps.isTTY ? parseAgentId(await deps.promptAgent(AGENT_CHOICES)) : detectAgentId(deps));
  const scope = flagScope ?? parseScope(await deps.promptChoice("Install for which scope?", SCOPES));

  return installSkill({ cwd: deps.cwd, env: deps.env, homeDir: deps.homeDir }, skill.name, files, scope, agentId, {
    copy: options.copy ?? false,
  });
}
