import { AGENT_IDS, extractSkillFiles, SkillSchema, type AgentId, type Scope } from "@in-org-quicko/skillset-shared";
import { hashSkillFiles, installSkill } from "@in-org-quicko/skillset-installer";
import { rethrowValidationError } from "../errors.js";
import { downloadBinary, registryFetch, type RegistryClient } from "../http.js";
import { openReadClient } from "../session.js";
import { parseScopeFlag, readInstalled, recordInstall, type InstalledDeps, type InstalledSkill } from "./installed.js";

export interface UpdateOptions {
  /** The Skills to update; empty means every one the lockfile records. */
  names?: string[];
  scope?: string;
  /** `--force`: replace a locally-modified Skill, discarding the edits. */
  force?: boolean;
}

/** One Skill's outcome from an update. */
export type UpdateOutcome =
  | { name: string; status: "updated"; from: string | null; to: string }
  | { name: string; status: "restored"; to: string }
  | { name: string; status: "up-to-date" }
  | { name: string; status: "skipped"; reason: "modified" }
  | { name: string; status: "gone" }
  | { name: string; status: "pending" }
  | { name: string; status: "error"; message: string };

/** Narrows a lockfile's recorded Agent, which is a plain string on disk and may name an Agent this build no longer knows. */
function knownAgent(recorded: string | null): AgentId | null {
  return recorded !== null && (AGENT_IDS as readonly string[]).includes(recorded) ? (recorded as AgentId) : null;
}

/**
 * Re-downloads one Skill and writes it over the installed copy.
 *
 * @remarks
 * Resolved by name rather than by the lockfile's recorded id, so a Skill
 * republished under the same name is followed even if the row behind it
 * changed — name is the publishing identity (ADR-0026), and the id is kept
 * for reporting rather than for resolution.
 */
async function reinstall(
  deps: InstalledDeps,
  client: RegistryClient,
  scope: Scope,
  installed: InstalledSkill,
): Promise<{ to: string }> {
  const query = installed.entry.namespace ? `?namespace=${encodeURIComponent(installed.entry.namespace)}` : "";
  const skill = await registryFetch(
    client,
    `/resources/skill/by-name/${encodeURIComponent(installed.name)}${query}`,
    SkillSchema,
  );
  const bytes = await downloadBinary(client, `/resources/${skill.id}/artifact?source=cli`);

  let files;
  try {
    files = extractSkillFiles(bytes);
  } catch (error) {
    rethrowValidationError(error);
  }

  const agentId = knownAgent(installed.entry.agent);
  await installSkill({ cwd: deps.cwd, env: deps.env, homeDir: deps.homeDir }, skill.name, files, scope, agentId, {
    copy: false,
  });

  await recordInstall(deps, scope, client.registry, skill.name, {
    id: skill.id,
    namespace: skill.namespace,
    registry_updated_at: skill.updated_at,
    content_hash: hashSkillFiles(files),
    installed_at: new Date().toISOString(),
    agent: agentId,
  });

  return { to: skill.updated_at };
}

/**
 * Brings installed Skills back into line with the Registry.
 *
 * @param deps - The fetch implementation, config path, environment, project
 * root, and home directory.
 * @param options - Which Skills (all of them when omitted), `--scope`
 * (defaults to the project), and `--force`.
 * @returns One outcome per Skill considered, in the order they were named —
 * or alphabetical when updating everything. One Skill failing never stops
 * the rest.
 * @throws Error when no Registry is configured, `--scope` names something
 * unknown, or a named Skill is not in the lockfile at all.
 *
 * @remarks
 * What each status means, and why the set is what it is. An `outdated`
 * Skill is re-downloaded (`updated`). A `missing` one — recorded but with
 * its directory gone — is re-downloaded too (`restored`), because a
 * lockfile entry with no files is the one case where writing files is
 * unambiguously what the User wants. A `current` one is left alone
 * (`up-to-date`), including its bytes: there is nothing to fetch.
 *
 * A `modified` Skill is **refused** unless `--force`, and that is the whole
 * reason this command records a digest. Overwriting a locally-edited Skill
 * silently is what `install` used to do, and this does not repeat it:
 * without versioning (ADR-0002) an update is a one-way door, so the edits
 * would be unrecoverable.
 *
 * A Skill the Registry no longer has reads `gone` and is left installed —
 * deleting a User's files because an Admin deleted a row is not this
 * command's call to make. One installed straight from a repository whose
 * Submission is still waiting reads `pending` and is left alone the same way;
 * once approved it reads `outdated` and moves onto the Registry's copy like
 * any other (ADR-0044).
 *
 * @example
 * ```ts
 * await runUpdate(deps, {});                                  // every stale Skill
 * await runUpdate(deps, { names: ["code-review"], force: true }); // one, edits discarded
 * ```
 */
export async function runUpdate(deps: InstalledDeps, options: UpdateOptions): Promise<UpdateOutcome[]> {
  const scope = parseScopeFlag(options.scope);
  const client = await openReadClient(deps);
  const installed = await readInstalled(deps, client, scope);

  const requested = options.names ?? [];
  if (requested.length > 0) {
    const known = new Set(installed.map((skill) => skill.name));
    const unknown = requested.filter((name) => !known.has(name));
    if (unknown.length > 0) {
      throw new Error(
        `Not installed at ${scope} scope: ${unknown.join(", ")}. Run \`skillset list\` to see what is, or \`skillset install\` to install one.`,
      );
    }
  }

  const byName = new Map(installed.map((skill) => [skill.name, skill]));
  const targets = requested.length > 0 ? requested.map((name) => byName.get(name) as InstalledSkill) : installed;

  const outcomes: UpdateOutcome[] = [];
  for (const skill of targets) {
    if (skill.status === "modified" && !options.force) {
      outcomes.push({ name: skill.name, status: "skipped", reason: "modified" });
      continue;
    }
    if (skill.registryUpdatedAt === undefined) {
      // Installed from a repository and not yet approved: there is no
      // Registry copy yet, which is not the same as one having been deleted.
      outcomes.push({ name: skill.name, status: skill.entry.registry_updated_at === null ? "pending" : "gone" });
      continue;
    }
    // A `current` Skill that `--force` named is still current: forcing is
    // permission to discard edits, not a reason to refetch identical bytes.
    if (skill.status === "current") {
      outcomes.push({ name: skill.name, status: "up-to-date" });
      continue;
    }

    try {
      const { to } = await reinstall(deps, client, scope, skill);
      outcomes.push(
        skill.status === "missing"
          ? { name: skill.name, status: "restored", to }
          : { name: skill.name, status: "updated", from: skill.entry.registry_updated_at, to },
      );
    } catch (error) {
      outcomes.push({ name: skill.name, status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return outcomes;
}
