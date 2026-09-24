import type { Scope } from "@in-org-quicko/skillset-shared";
import { removeSkill } from "@in-org-quicko/skillset-installer";
import { detectAgentId, forgetInstall, parseScopeFlag, type InstalledDeps } from "./installed.js";

export interface RemoveOptions {
  name: string;
  scope?: string;
}

/** What `skillset remove` deleted. */
export interface RemoveCommandReport {
  name: string;
  scope: Scope;
  /** The canonical directory removed, or `null` when the files were already gone. */
  skillDirectory: string | null;
  /** The Agent's own symlink or copy removed, or `null` when there was none. */
  link: string | null;
  /** Whether a lockfile entry was dropped — `false` for a Skill installed before lockfiles, or by hand. */
  forgotten: boolean;
}

/**
 * Removes an installed Skill: its canonical copy, the Agent's own link to
 * it, and its lockfile entry.
 *
 * @param deps - The environment, project root, and home directory to
 * resolve paths against.
 * @param options - The Skill's name, and `--scope` (defaults to the project).
 * @returns What was removed. Every field is independently `null`/`false`
 * when there was nothing to remove.
 * @throws Error when `--scope` names something unknown, when the Skill's
 * name sanitises to nothing, or when a path exists but cannot be deleted.
 *
 * @remarks
 * Deliberately forgiving about partial state, because there are several
 * ordinary ways to reach it: a Skill installed before lockfiles existed has
 * files and no entry, one whose directory was deleted by hand has an entry
 * and no files, and either should come out cleanly rather than erroring on
 * whichever half is missing. The report says which halves were actually
 * there.
 *
 * The Agent unlinked is whichever {@link detectAgentId} resolves now, from
 * the environment and the project's Agent directories — the lockfile
 * records no Agent, so removing a Skill from a different Agent's context
 * than the one it was installed for unlinks that Agent's directory instead.
 *
 * Needs no Registry and no Token: everything this does is local.
 *
 * @example
 * ```ts
 * await runRemove(deps, { name: "code-review", scope: "project" });
 * ```
 */
export async function runRemove(deps: InstalledDeps, options: RemoveOptions): Promise<RemoveCommandReport> {
  const scope = parseScopeFlag(options.scope);

  const report = await removeSkill(
    { cwd: deps.cwd, env: deps.env, homeDir: deps.homeDir },
    options.name,
    scope,
    detectAgentId(deps),
  );
  const forgotten = await forgetInstall(deps, scope, options.name);

  return { name: options.name, scope, skillDirectory: report.skillDirectory, link: report.link, forgotten };
}
