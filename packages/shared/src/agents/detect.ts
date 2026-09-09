import { AGENT_IDS, AGENTS, type AgentId } from "./table.js";

/**
 * Which rung of {@link detectAgent}'s ladder produced the answer. Reported alongside every
 * result so a wrong guess is visible to the User rather than silent (spec, "Detecting the
 * Agent").
 */
export type DetectionStep = "override" | "client-identity" | "environment" | "project-directory" | "canonical-fallback";

/** The outcome of {@link detectAgent}: the Agent that was identified, and how. */
export interface AgentDetection {
  /**
   * The identified Agent, or `null` when none of the signals resolved one — in which case the
   * install goes to the canonical `.agents/skills` directory and links nothing, which is
   * correct for the universal Agents and a working (unlinked) install for the rest.
   */
  agentId: AgentId | null;
  step: DetectionStep;
}

/** The signals {@link detectAgent} resolves an Agent from, in ladder order. */
export interface DetectAgentSignals {
  /** The `--agent` value, when the User set the override. Validated against the Agent table. */
  override?: string;
  /**
   * The client's self-reported name — an MCP client's `clientInfo.name`, or a host process's
   * equivalent. Matched case-insensitively against every Agent's id and display name.
   */
  clientName?: string;
  /** The environment, matched against each Agent's `envMarkers` in the Agent table. */
  env?: Record<string, string | undefined>;
  /**
   * The non-universal Agents whose own project directory exists on disk. The caller computes
   * this — `nonUniversalProjectSkillsDirs` (in the Agent table module) lists the candidates and
   * the caller stats them, keeping this module free of filesystem access.
   */
  agentDirsPresent?: readonly AgentId[];
}

/** Whether `value` holds something other than whitespace. */
function isSet(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function matchClientName(clientName: string): AgentId | null {
  const needle = clientName.trim().toLowerCase();
  if (!needle) return null;
  const hit = AGENTS.find((agent) => agent.id.toLowerCase() === needle || agent.displayName.toLowerCase() === needle);
  return hit ? hit.id : null;
}

function matchEnvMarker(env: Record<string, string | undefined>): AgentId | null {
  const hit = AGENTS.find((agent) => agent.envMarkers?.some((key) => isSet(env[key])));
  return hit ? hit.id : null;
}

/**
 * Resolves which coding Agent is running, so the MCP server and the CLI can install into the
 * directory that Agent already reads without the User naming it (spec, "Detecting the Agent").
 *
 * The ladder is walked in order and the first rung to answer wins:
 *
 * 1. `override` — the `--agent` escape hatch, validated against the table.
 * 2. `clientName` — the protocol-native signal, matched against Agent ids and display names.
 * 3. `env` — an Agent-specific environment marker (see the Agent table's `envMarkers`).
 * 4. `agentDirsPresent` — exactly one non-universal Agent's directory present in the project.
 * 5. Canonical fallback — no Agent; the caller installs to `.agents/skills` and links nothing.
 *
 * @param signals - The override, client name, environment, and on-disk Agent directories to
 * resolve from. Every field is optional; with none set, the result is the canonical fallback.
 * @returns The identified Agent (or `null`) and the rung that produced it.
 * @throws Error when `signals.override` is set but names no Agent in the table; the message
 * lists the valid ids.
 *
 * @remarks
 * Precision is deliberately loose. Ten Agents read the canonical directory directly, so the
 * ladder never tries to tell them apart — steps 3 and 4 only concern the Agents with a
 * directory of their own, and everything else lands on the canonical fallback, which produces
 * a byte-identical install for those ten.
 *
 * @example
 * ```ts
 * detectAgent({ clientName: "Claude Code" });
 * // -> { agentId: "claude-code", step: "client-identity" }
 *
 * detectAgent({ env: { CLAUDECODE: "1" } });
 * // -> { agentId: "claude-code", step: "environment" }
 *
 * detectAgent({});
 * // -> { agentId: null, step: "canonical-fallback" }
 * ```
 */
export function detectAgent(signals: DetectAgentSignals): AgentDetection {
  if (signals.override !== undefined) {
    if (!(AGENT_IDS as readonly string[]).includes(signals.override)) {
      throw new Error(`--agent must be one of: ${AGENT_IDS.join(", ")}.`);
    }
    return { agentId: signals.override as AgentId, step: "override" };
  }

  if (signals.clientName) {
    const byClient = matchClientName(signals.clientName);
    if (byClient) return { agentId: byClient, step: "client-identity" };
  }

  if (signals.env) {
    const byEnv = matchEnvMarker(signals.env);
    if (byEnv) return { agentId: byEnv, step: "environment" };
  }

  const present = signals.agentDirsPresent ?? [];
  if (present.length === 1) {
    return { agentId: present[0] as AgentId, step: "project-directory" };
  }

  return { agentId: null, step: "canonical-fallback" };
}
