import { AGENTS, extractSkillFiles, SkillSchema, type AgentId, type Scope } from "@skill-registry/shared";
import { rethrowValidationError } from "../errors.js";
import { downloadBinary, registryFetch } from "../http.js";
import { installSkill, type WriteReport } from "../install.js";
import { promptChoice, type PromptIO } from "../prompt.js";
import { openReadClient, type SessionDeps } from "../session.js";

export interface AddDeps extends SessionDeps, PromptIO {
  cwd: string;
  homeDir: string;
}

export interface AddOptions {
  name: string;
  agent?: string;
  scope?: string;
}

const SCOPES: readonly Scope[] = ["project", "user"];

/** Every Agent `add` can install for, in the order the prompt and the `--agent` help list them. */
export const AGENT_IDS: readonly AgentId[] = AGENTS.map((agent) => agent.id);

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
 * Downloads a Skill and installs it where the chosen Agent will read it.
 *
 * @param deps - The fetch implementation, config-file path, environment, project root,
 * home directory, and the terminal to prompt through.
 * @param options - The Skill's name, plus `--agent` and `--scope` when they were given.
 * @returns Where the Skill was written and every Agent that reads that directory.
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
 * await runAdd(deps, { name: "code-review", agent: "codex", scope: "project" });
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
  const agentId = flagAgent ?? parseAgentId(await promptChoice("Install for which Agent?", AGENT_IDS, deps));
  const scope = flagScope ?? parseScope(await promptChoice("Install for which scope?", SCOPES, deps));

  return installSkill({ cwd: deps.cwd, env: deps.env, homeDir: deps.homeDir }, skill.name, files, scope, agentId);
}
