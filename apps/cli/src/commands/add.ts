import { AGENTS, SkillSchema, SkillValidationError, planExtraction, type AgentId, type Scope } from "@skill-registry/shared";
import { NOT_LOGGED_IN_MESSAGE, readConfig, resolveCredentials } from "../config.js";
import { downloadBinary, registryFetch, type RegistryClient } from "../http.js";
import { installSkill, type WriteReport } from "../install.js";
import { promptChoice, promptMultiChoice, type PromptIO } from "../prompt.js";

export interface AddDeps extends PromptIO {
  fetch: typeof fetch;
  configPath: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  homeDir: string;
}

export interface AddOptions {
  name: string;
  agent?: string[];
  scope?: string;
}

const SCOPES: readonly Scope[] = ["project", "user"];
const AGENT_IDS: readonly AgentId[] = AGENTS.map((agent) => agent.id);

function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

function isAgentId(value: string): value is AgentId {
  return (AGENT_IDS as readonly string[]).includes(value);
}

/**
 * Downloads and installs a Skill (story: `skillreg add`). Scope and Agent(s) come from
 * `--scope`/`--agent`, or are prompted for when a terminal is attached; with either
 * missing and no terminal, this errors immediately — before any network call, same as
 * publish's local-validation-first behaviour.
 */
export async function runAdd(deps: AddDeps, options: AddOptions): Promise<WriteReport[]> {
  const fileConfig = await readConfig(deps.configPath);
  const credentials = resolveCredentials(deps.env, fileConfig);
  if (!credentials) throw new Error(NOT_LOGGED_IN_MESSAGE);

  const hasAgents = (options.agent?.length ?? 0) > 0;
  if ((!options.scope || !hasAgents) && !deps.isTTY) {
    throw new Error("Not a terminal — pass --scope and --agent.");
  }

  if (options.scope && !isScope(options.scope)) {
    throw new Error(`Unknown scope "${options.scope}" — choose one of: ${SCOPES.join(", ")}.`);
  }
  if (hasAgents) {
    const unknown = options.agent!.filter((id) => !isAgentId(id));
    if (unknown.length > 0) {
      throw new Error(`Unknown Agent(s) ${unknown.join(", ")} — choose from: ${AGENT_IDS.join(", ")}.`);
    }
  }

  const client: RegistryClient = { fetch: deps.fetch, registry: credentials.registry, token: credentials.token };
  const skill = await registryFetch(client, `/skills/by-name/${encodeURIComponent(options.name)}`, SkillSchema);
  const bytes = await downloadBinary(client, `/skills/${skill.id}/artifact`);

  let files;
  try {
    files = planExtraction(bytes);
  } catch (error) {
    if (error instanceof SkillValidationError) {
      throw new Error(`${error.rule}: ${error.message}${error.field ? ` (${error.field})` : ""}`);
    }
    throw error;
  }

  const scope: Scope = options.scope
    ? (options.scope as Scope)
    : ((await promptChoice("Install for which scope?", SCOPES, deps)) as Scope);
  const agentIds: AgentId[] = hasAgents
    ? (options.agent as AgentId[])
    : ((await promptMultiChoice("Install for which Agent(s)?", AGENT_IDS, deps)) as AgentId[]);

  return installSkill({ cwd: deps.cwd, env: deps.env, homeDir: deps.homeDir }, skill.name, files, scope, agentIds);
}
