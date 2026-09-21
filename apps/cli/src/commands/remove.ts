import { AGENT_IDS, type AgentId, type Scope } from "@in-org-quicko/skillset-shared";
import { readLockfile, removeSkill, resolveLockfilePath } from "@in-org-quicko/skillset-installer";
import { forgetInstall, parseScopeFlag, type InstalledDeps } from "./installed.js";

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

/** Narrows a lockfile's recorded Agent, which is a plain string on disk and may name an Agent this build no longer knows. */
function knownAgent(recorded: string | null): AgentId | null {
  return recorded !== null && (AGENT_IDS as readonly string[]).includes(recorded) ? (recorded as AgentId) : null;
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
 * The Agent unlinked is the one the lockfile *recorded at install time*,
 * not whichever Agent is detected now — removing a Skill installed for
 * Cursor from inside Claude Code must still unlink Cursor's directory. An
 * entry naming an Agent this build no longer knows unlinks nothing rather
 * than failing; the canonical copy still goes.
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
  const lockfile = await readLockfile(resolveLockfilePath(scope, deps), "");
  const recorded = lockfile.skills[options.name];

  const report = await removeSkill(
    { cwd: deps.cwd, env: deps.env, homeDir: deps.homeDir },
    options.name,
    scope,
    knownAgent(recorded?.agent ?? null),
  );
  const forgotten = await forgetInstall(deps, scope, options.name);

  return { name: options.name, scope, skillDirectory: report.skillDirectory, link: report.link, forgotten };
}
