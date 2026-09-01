import { AGENTS, extractSkillFiles, SkillSchema, type AgentId, type Scope } from "@skill-registry/shared";
import { rethrowValidationError } from "../errors.js";
import { downloadBinary, registryFetch } from "../http.js";
import { installSkill, type WriteReport } from "../install.js";
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

/** Every Agent `add` can install for, in the order the prompt and the `--agent` help list them. */
export const AGENT_IDS: readonly AgentId[] = AGENTS.map((agent) => agent.id);

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
 * Downloads a Skill and installs it, always into the canonical `.agents/skills` directory,
 * symlinking the chosen Agent's own directory to it where they differ (ADR-0022).
 *
 * @param deps - The fetch implementation, config-file path, environment, project root,
 * home directory, whether a terminal is attached, and how to prompt when a flag is missing.
 * @param options - The Skill's name, plus `--agent`, `--scope`, and `--copy` when given.
 * @returns Where the Skill's files were written, the Agent chosen, and how its directory
 * was linked.
 * @throws Error when no Registry is configured; when `--agent` or `--scope` is missing and
 * no terminal is attached, so there is nothing to prompt and nothing to default to; when
 * either flag names something unknown; or, naming the rule, when the downloaded Artifact
 * fails inspection.
 * @throws ApiError when the Registry has no Skill by that name, or refuses the download.
 * @throws RegistryUnreachableError when the Registry cannot be reached.
 *
 * @remarks
 * Reads need no Token (ADR-0013), so this works against a Registry the User has never
 * logged in to. Everything that can fail without the network — the terminal check and both
 * flags — is checked first, matching publish's local-validation-first behaviour. The
 * Artifact is inspected before a single byte is written, because this is the only place a
 * hostile one is stopped (ADR-0001).
 *
 * @example
 * ```ts
 * await runAdd(deps, { name: "code-review", agent: "claude-code", scope: "project" });
 * ```
 */
export async function runAdd(deps: AddDeps, options: AddOptions): Promise<WriteReport> {
  const client = await openReadClient(deps);

  if ((!options.scope || !options.agent) && !deps.isTTY) {
    throw new Error("Not a terminal — pass --scope and --agent.");
  }

  const flagScope = options.scope ? parseScope(options.scope) : null;
  const flagAgent = options.agent ? parseAgentId(options.agent) : null;

  const skill = await registryFetch(client, `/skills/by-name/${encodeURIComponent(options.name)}`, SkillSchema);
  const bytes = await downloadBinary(client, `/skills/${skill.id}/artifact`);

  let files;
  try {
    files = extractSkillFiles(bytes);
  } catch (error) {
    rethrowValidationError(error);
  }

  // Agent before Scope, matching the ticket's prompt order.
  const agentId = flagAgent ?? parseAgentId(await deps.promptAgent(AGENT_CHOICES));
  const scope = flagScope ?? parseScope(await deps.promptChoice("Install for which scope?", SCOPES));

  return installSkill({ cwd: deps.cwd, env: deps.env, homeDir: deps.homeDir }, skill.name, files, scope, agentId, {
    copy: options.copy ?? false,
  });
}
