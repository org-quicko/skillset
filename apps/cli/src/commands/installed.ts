import { existsSync } from "node:fs";
import { detectAgent, nonUniversalProjectSkillsDirs, SkillSchema, type AgentId, type Scope } from "@in-org-quicko/skillset-shared";
import {
  readInstalled as readInstalledAt,
  type InstalledSkill,
  type RegistryLookup,
} from "@in-org-quicko/skillset-installer";
import { ApiError, registryFetch, type RegistryClient } from "../http.js";
import type { SessionDeps } from "../session.js";

export { forgetInstall, recordInstall } from "@in-org-quicko/skillset-installer";
export type { InstalledSkill } from "@in-org-quicko/skillset-installer";

/** The filesystem context every lockfile-aware command resolves paths against. */
export interface InstalledDeps extends SessionDeps {
  cwd: string;
  homeDir: string;
}

/** Turns a `--scope` flag into a Scope, defaulting to the project. */
export function parseScopeFlag(value: string | undefined): Scope {
  if (value === undefined) return "project";
  if (value !== "project" && value !== "user") {
    throw new Error(`Unknown scope "${value}" — choose from: project, user.`);
  }
  return value;
}

/**
 * Detects which Agent a command should act for from the environment and the
 * project's Agent directories, the same ladder `install` falls back to when
 * `--agent` and a prompt are both unavailable.
 *
 * @remarks
 * `update` and `remove` call this instead of trusting a lockfile-recorded
 * Agent: the lockfile no longer stores one, so both re-detect at call time
 * and act on whichever Agent that resolves to now, which may differ from the
 * one an earlier install resolved to.
 *
 * @param deps - Supplies the environment, project root, and home directory to
 * resolve and stat Agent directories against.
 * @returns The detected {@link AgentId}, or `null` when nothing resolved one.
 */
export function detectAgentId(deps: Pick<InstalledDeps, "env" | "cwd" | "homeDir">): AgentId | null {
  const resolveCtx = { env: deps.env, homeDir: deps.homeDir, projectRoot: deps.cwd };
  const agentDirsPresent = nonUniversalProjectSkillsDirs(resolveCtx)
    .filter(({ dir }) => existsSync(dir))
    .map(({ agentId }) => agentId);
  return detectAgent({ env: deps.env, agentDirsPresent }).agentId;
}

/**
 * The Registry lookup `readInstalled` needs, over this CLI's own client.
 *
 * @remarks
 * A 404 answers `undefined` rather than throwing: a Skill an Admin deleted
 * is still installed locally, and reporting that is more useful than
 * failing a whole listing over one row. Every other refusal still throws —
 * a 500 or a 403 is not the same as "no longer published", and quietly
 * reading it as one would hide a broken Registry behind a clean listing.
 */
function lookupThrough(client: RegistryClient): RegistryLookup {
  return async (name, namespace) => {
    try {
      const query = namespace ? `?namespace=${encodeURIComponent(namespace)}` : "";
      const skill = await registryFetch(client, `/resources/skill/by-name/${encodeURIComponent(name)}${query}`, SkillSchema);
      return skill.updated_at;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return undefined;
      throw error;
    }
  };
}

/**
 * Reads what is installed at `scope`, consulting `client` for each Skill's
 * current state at the Registry.
 *
 * @param deps - Project root, home directory, and environment.
 * @param client - The Registry to consult, or `null` to skip it — then
 * nothing can read `outdated`.
 * @param scope - Which Scope's lockfile to read.
 * @returns One entry per Skill the lockfile records, alphabetical by name.
 * @throws ApiError when the Registry refuses a lookup with anything but a 404.
 * @throws RegistryUnreachableError when the Registry cannot be reached.
 * @example
 * ```ts
 * const installed = await readInstalled(deps, client, "project");
 * ```
 */
export async function readInstalled(
  deps: InstalledDeps,
  client: RegistryClient | null,
  scope: Scope,
): Promise<InstalledSkill[]> {
  return readInstalledAt(
    { cwd: deps.cwd, env: deps.env, homeDir: deps.homeDir },
    scope,
    client ? lookupThrough(client) : null,
  );
}
