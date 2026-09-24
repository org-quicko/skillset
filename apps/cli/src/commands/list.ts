import type { Scope } from "@in-org-quicko/skillset-shared";
import { resolveLockfilePath } from "@in-org-quicko/skillset-installer";
import { openReadClient } from "../session.js";
import { RegistryUnreachableError } from "../http.js";
import { parseScopeFlag, readInstalled, type InstalledDeps, type InstalledSkill } from "./installed.js";

export interface ListOptions {
  scope?: string;
  /** `--offline`: skip the Registry entirely, so nothing can read `outdated`. */
  offline?: boolean;
}

/** What `skillset list` found, and where it looked. */
export interface ListReport {
  scope: Scope;
  /** The lockfile the listing came from — named so a reader is never left guessing which Scope they are seeing. */
  lockfilePath: string;
  skills: InstalledSkill[];
  /** True when the Registry could not be reached, so every Skill reads as `current` at best. */
  offline: boolean;
}

/**
 * Lists the Skills installed at one Scope, each with how it stands against
 * the Registry and against what was written.
 *
 * @param deps - The fetch implementation, config path, environment, project
 * root, and home directory.
 * @param options - `--scope` (defaults to the project) and `--offline`.
 * @returns The Scope listed, the lockfile it came from, and one row per
 * Skill — alphabetical, and empty when nothing is installed.
 * @throws Error when no Registry is configured, or `--scope` names something
 * unknown.
 * @throws ApiError when the Registry refuses a lookup with anything but a 404.
 *
 * @remarks
 * A Registry that cannot be reached degrades rather than fails: the listing
 * still reports what is installed and whether it has been edited locally —
 * both of which are answerable from the filesystem alone — and only
 * `outdated` becomes unknowable. That is the difference `--offline` makes
 * deliberately, and an unreachable Registry makes by accident.
 *
 * Reads need no Token (ADR-0013), so this works against a Registry the User
 * has never logged in to.
 *
 * @example
 * ```ts
 * const report = await runList(deps, { scope: "project" });
 * const stale = report.skills.filter((skill) => skill.status === "outdated");
 * ```
 */
export async function runList(deps: InstalledDeps, options: ListOptions): Promise<ListReport> {
  const scope = parseScopeFlag(options.scope);
  const client = await openReadClient(deps);

  if (options.offline) {
    return { scope, lockfilePath: resolveLockfilePath(scope, deps), skills: await readInstalled(deps, null, scope), offline: true };
  }

  try {
    return { scope, lockfilePath: resolveLockfilePath(scope, deps), skills: await readInstalled(deps, client, scope), offline: false };
  } catch (error) {
    if (!(error instanceof RegistryUnreachableError)) throw error;
    return { scope, lockfilePath: resolveLockfilePath(scope, deps), skills: await readInstalled(deps, null, scope), offline: true };
  }
}
