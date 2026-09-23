import { AGENT_IDS, SkillSchema, type AgentId, type Scope } from "@in-org-quicko/skillset-shared";
import {
  forgetInstall,
  readInstalled,
  removeSkill,
  type InstallContext,
  type RegistryLookup,
  type SkillStatus,
} from "@in-org-quicko/skillset-installer";
import { installSkills, type InstallSkillsDeps, type InstallSkillsResult } from "./install-skills.js";

/**
 * The three local-inventory tools in one module, because they share one
 * question — what does the lockfile say is here, and how does it stand? —
 * and splitting them would mean three copies of {@link registryLookup} and
 * of the Agent narrowing below.
 */

/** What every tool here needs: where to reach the Registry, and where on disk to look. */
export interface LifecycleDeps {
  fetchImpl: typeof fetch;
  registry: string;
  ctx: InstallContext;
  scope: Scope;
}

/** One installed Skill, as an Agent needs to see it. */
export interface InstalledSkillReport {
  name: string;
  status: SkillStatus;
  directory: string;
  installed_at: string;
  /** What the Registry holds now, or `null` when it no longer has this Skill. */
  registry_updated_at: string | null;
}

/** One Skill's outcome from {@link removeSkills}. */
export type RemoveSkillOutcome =
  | { name: string; status: "removed"; skillDirectory: string | null; link: string | null }
  | { name: string; status: "not-installed" }
  | { name: string; status: "error"; message: string };

/** Narrows a lockfile's recorded Agent, which is a plain string on disk and may name an Agent this build no longer knows. */
function knownAgent(recorded: string | null): AgentId | null {
  return recorded !== null && (AGENT_IDS as readonly string[]).includes(recorded) ? (recorded as AgentId) : null;
}

/**
 * The Registry lookup `readInstalled` needs, over this server's plain `fetch`.
 *
 * @remarks
 * A 404 answers `undefined` rather than throwing: a Skill an Admin deleted
 * is still installed locally, and saying so is more useful than failing the
 * whole inventory over one row.
 */
function registryLookup(fetchImpl: typeof fetch, registry: string): RegistryLookup {
  return async (name, namespace) => {
    const url = new URL(`/api/resources/skill/by-name/${encodeURIComponent(name)}`, registry);
    if (namespace) url.searchParams.set("namespace", namespace);
    const res = await fetchImpl(url);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`Could not read "${name}" from the Registry (status ${res.status}).`);
    return SkillSchema.parse(await res.json()).updated_at;
  };
}

/**
 * Reports what is installed at this Scope and how each Skill stands.
 *
 * @param deps - The `fetch` implementation, Registry URL, filesystem
 * context, and Scope.
 * @returns One row per Skill the lockfile records, alphabetical by name;
 * empty when nothing has been installed.
 * @throws Error when the Registry refuses a lookup with anything but a 404,
 * or a Skill's directory cannot be read.
 *
 * @remarks
 * The counterpart to `search_skills`: that one answers what the team has
 * published, this one answers what this project actually uses. An Agent
 * asked to "update the skills here" needs both, and could previously see
 * neither.
 *
 * `status` carries the whole point. `outdated` means the Registry has
 * moved on; `modified` means someone edited the installed copy and an
 * update would discard that; `missing` means the lockfile records a Skill
 * whose files are gone.
 *
 * @example
 * ```ts
 * const installed = await installedSkills(deps);
 * installed.filter((skill) => skill.status === "outdated");
 * ```
 */
export async function installedSkills(deps: LifecycleDeps): Promise<InstalledSkillReport[]> {
  const installed = await readInstalled(deps.ctx, deps.scope, registryLookup(deps.fetchImpl, deps.registry));
  return installed.map((skill) => ({
    name: skill.name,
    status: skill.status,
    directory: skill.directory,
    installed_at: skill.entry.installed_at,
    registry_updated_at: skill.registryUpdatedAt ?? null,
  }));
}

/**
 * Re-downloads installed Skills the Registry has moved on from.
 *
 * @param deps - The `fetch` implementation, Registry URL, filesystem
 * context, and Scope.
 * @param options - `names` to update just those (every stale one when
 * omitted), and `force` to replace a locally-modified Skill.
 * @returns The same shape `install_skills` returns, so a caller reads one
 * result format for both — with `refused` standing for a Skill left alone.
 * @throws Error when the Registry cannot be reached at all.
 *
 * @remarks
 * A locally-modified Skill is **skipped** unless `force`, and is reported
 * as `refused` rather than quietly overwritten. Without versioning
 * (ADR-0002) an update cannot be undone, so discarding someone's edits has
 * to be something they asked for.
 *
 * Delegates the actual work to {@link installSkills} with `overwrite`,
 * rather than repeating the resolve-download-validate-write sequence — the
 * decision of *which* Skills to write is all this adds.
 *
 * @example
 * ```ts
 * await updateSkills(deps, {});                                  // every stale Skill
 * await updateSkills(deps, { names: ["code-review"], force: true });
 * ```
 */
export async function updateSkills(
  deps: LifecycleDeps & Pick<InstallSkillsDeps, "detection">,
  options: { names?: string[]; force?: boolean },
): Promise<InstallSkillsResult> {
  const installed = await readInstalled(deps.ctx, deps.scope, registryLookup(deps.fetchImpl, deps.registry));
  const wanted = options.names?.length ? installed.filter((skill) => options.names?.includes(skill.name)) : installed;

  // A Skill installed straight from a repository and not yet approved has no
  // Registry copy to restore or refresh from (ADR-0044), so it is left alone.
  const writable = wanted.filter(
    (skill) =>
      !(skill.entry.registry_updated_at === null && skill.registryUpdatedAt === undefined) &&
      (skill.status === "outdated" || skill.status === "missing" || (skill.status === "modified" && options.force)),
  );
  const refused = wanted
    .filter((skill) => skill.status === "modified" && !options.force)
    // Always `modified` — the filter above admits nothing else — so the status
    // is carried straight through rather than recomputed from disk.
    .map((skill) => ({ name: skill.name, status: "refused" as const, existing: skill.name, installed: "modified" as const }));

  if (writable.length === 0) {
    return { detection: deps.detection, outcomes: refused };
  }

  const result = await installSkills(
    {
      fetchImpl: deps.fetchImpl,
      registry: deps.registry,
      ctx: deps.ctx,
      scope: deps.scope,
      detection: deps.detection,
      overwrite: true,
    },
    writable.map((skill) => skill.name),
  );
  return { detection: result.detection, outcomes: [...result.outcomes, ...refused] };
}

/**
 * Uninstalls Skills: their files, the Agent's link to each, and their
 * lockfile entries.
 *
 * @param deps - The filesystem context and Scope. No Registry is consulted.
 * @param names - The Skills to remove.
 * @returns One outcome per name, in the order given. One failing never
 * stops the rest.
 *
 * @remarks
 * The Agent unlinked is the one the lockfile recorded at install time, not
 * whichever Agent is running now — removing a Skill installed for Cursor
 * from inside Claude Code must still unlink Cursor's directory.
 *
 * A Skill with neither files nor a lockfile entry reads `not-installed`
 * rather than erroring, so removing something twice is harmless.
 *
 * @example
 * ```ts
 * await removeSkills(deps, ["code-review"]);
 * ```
 */
export async function removeSkills(
  deps: Pick<LifecycleDeps, "ctx" | "scope">,
  names: readonly string[],
): Promise<RemoveSkillOutcome[]> {
  const installed = await readInstalled(deps.ctx, deps.scope, null);
  const byName = new Map(installed.map((skill) => [skill.name, skill]));

  const outcomes: RemoveSkillOutcome[] = [];
  for (const name of names) {
    try {
      const recorded = byName.get(name);
      const report = await removeSkill(deps.ctx, name, deps.scope, knownAgent(recorded?.entry.agent ?? null));
      const forgotten = await forgetInstall(deps.ctx, deps.scope, name);

      outcomes.push(
        report.skillDirectory === null && report.link === null && !forgotten
          ? { name, status: "not-installed" }
          : { name, status: "removed", skillDirectory: report.skillDirectory, link: report.link },
      );
    } catch (error) {
      outcomes.push({ name, status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }
  return outcomes;
}
