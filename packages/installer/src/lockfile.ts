import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { Scope, SkillFile } from "@in-org-quicko/skillset-shared";
import { resolveInstallTarget, type InstallContext } from "./index.js";

/** The lockfile's own format version, bumped only when an older reader could misread a newer file. */
export const LOCKFILE_VERSION = 1;

/** The lockfile's name, at a project root or a User's home directory. */
export const LOCKFILE_NAME = "skillset-lock.json";

/** What was installed for one Skill, and what it was installed from. */
export interface LockfileEntry {
  /**
   * The Resource id, so a rename at the Registry is still resolvable. `null`
   * for a Skill installed straight from a repository, which has no Resource
   * behind it until an Admin approves its Submission (ADR-0044).
   */
  id: string | null;
  /**
   * Which party named the Skill (ADR-0042) — half of what identifies it at the
   * Registry, and the only way to tell that the directory now holding `pdf` is
   * a different Skill from the `pdf` being installed over it.
   *
   * Optional, and no `version` bump with it: an entry written before
   * Namespaces existed has none, which reads as "unknown" rather than "named
   * here" — so an install over one is allowed, exactly as it was before. An
   * older CLI ignores the key, and this one tolerates its absence, which is
   * what a bump would have cost for nothing.
   */
  namespace?: string;
  /**
   * The Registry's `updated_at` for this Skill at the moment it was
   * installed. Compared against the Registry's current value to decide
   * whether the installed copy is stale — there are no versions to compare
   * instead (ADR-0002).
   *
   * `null` for a Skill installed straight from a repository (ADR-0044). The
   * first time the Registry reports one � its Submission was approved � the
   * two differ, the Skill reads `outdated`, and `update` moves it onto the
   * Registry's copy with nothing else to do.
   */
  registry_updated_at: string | null;
  /**
   * The repository a Skill was installed straight from, rather than from the
   * Registry (ADR-0044). Absent for a Registry install.
   */
  source?: string;
  /** `sha256:<hex>` over the files as installed — see {@link hashSkillFiles}. */
  content_hash: string;
  installed_at: string;
}

/** Every Skill installed at one Scope, and the Registry they came from. */
export interface Lockfile {
  version: number;
  /** The Registry every entry was resolved against; a later install from a different one replaces it. */
  registry: string;
  skills: Record<string, LockfileEntry>;
}

/** How an installed Skill stands against the Registry and against what was written. */
export type SkillStatus = "current" | "outdated" | "modified" | "missing";

/**
 * Where the lockfile for `scope` lives.
 *
 * @remarks
 * A project root or a home directory, beside the thing it describes rather
 * than inside `.agents/` — a lockfile is the User's record of what they
 * installed, not part of any Agent's skill tree, and an Agent that scans
 * its skills directory should never find it there.
 *
 * @param scope - "project" for the project root, "user" for the home directory.
 * @param ctx - Supplies `cwd` (the project root) and `homeDir`.
 * @returns An absolute path, which need not exist yet.
 * @example
 * ```ts
 * resolveLockfilePath("project", ctx); // -> "<cwd>/skillset-lock.json"
 * ```
 */
export function resolveLockfilePath(scope: Scope, ctx: Pick<InstallContext, "cwd" | "homeDir">): string {
  return join(scope === "project" ? ctx.cwd : ctx.homeDir, LOCKFILE_NAME);
}

/** A lockfile with no entries, for a Scope nothing has been installed at yet. */
function emptyLockfile(registry: string): Lockfile {
  return { version: LOCKFILE_VERSION, registry, skills: {} };
}

/**
 * Reads the lockfile at `path`.
 *
 * @remarks
 * Every failure short of an unreadable disk answers with an empty lockfile
 * rather than throwing: a missing file is the ordinary pre-install state,
 * and a corrupt or hand-edited one should not make `install` refuse.
 * The cost of being wrong is one Skill reported as `missing` that is
 * actually present, which the next install corrects.
 *
 * A file whose `version` is newer than this reader understands is also
 * treated as empty, for the same reason — guessing at a format from the
 * future is worse than rebuilding a record of what is on disk.
 *
 * @param path - Where the lockfile lives, from {@link resolveLockfilePath}.
 * @param registry - The Registry to stamp on a lockfile that had to be
 * created, ignored when one was read.
 * @returns The stored lockfile, or an empty one.
 * @throws Error for a filesystem failure other than the file not existing —
 * a permissions problem is worth surfacing, unlike a missing file.
 * @example
 * ```ts
 * const lock = await readLockfile(resolveLockfilePath("project", ctx), registry);
 * ```
 */
export async function readLockfile(path: string, registry: string): Promise<Lockfile> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyLockfile(registry);
    throw error;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Lockfile>;
    if (typeof parsed.version !== "number" || parsed.version > LOCKFILE_VERSION) return emptyLockfile(registry);
    if (typeof parsed.skills !== "object" || parsed.skills === null) return emptyLockfile(registry);
    return {
      version: parsed.version,
      registry: typeof parsed.registry === "string" ? parsed.registry : registry,
      skills: parsed.skills,
    };
  } catch {
    return emptyLockfile(registry);
  }
}

/**
 * Writes `lockfile` to `path`, or removes the file when nothing is left in it.
 *
 * @remarks
 * Removing an emptied lockfile rather than leaving `{"skills":{}}` behind is
 * what stops `skillset remove` of the last Skill from leaving litter in a
 * project root that had none before.
 *
 * @param path - Where to write, from {@link resolveLockfilePath}.
 * @param lockfile - The record to store.
 * @throws Error when the file cannot be written or removed.
 */
export async function writeLockfile(path: string, lockfile: Lockfile): Promise<void> {
  if (Object.keys(lockfile.skills).length === 0) {
    await rm(path, { force: true });
    return;
  }
  const ordered: Lockfile = {
    version: lockfile.version,
    registry: lockfile.registry,
    // Sorted so the file is stable across installs and reviews as a small
    // diff rather than a reordering.
    skills: Object.fromEntries(Object.entries(lockfile.skills).sort(([a], [b]) => a.localeCompare(b))),
  };
  await writeFile(path, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
}

/**
 * Digests a Skill's files into the value a lockfile entry stores.
 *
 * @remarks
 * Order-independent and separator-independent: paths are sorted and each
 * contributes its own length before its bytes, so neither the order files
 * arrived in nor a rename that shuffles them changes the digest, and no
 * concatenation of one file's path into another's content can collide.
 *
 * This is what makes local modification detectable. It is not a security
 * boundary — nothing signs it, and a lockfile is as editable as the files it
 * describes.
 *
 * @param files - The Skill's files, at paths relative to its root.
 * @returns `sha256:<hex>`.
 * @example
 * ```ts
 * hashSkillFiles([{ path: "SKILL.md", bytes: new Uint8Array([1]) }]);
 * // -> "sha256:…"
 * ```
 */
export function hashSkillFiles(files: readonly SkillFile[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(`${file.path}\0${file.bytes.byteLength}\0`);
    hash.update(file.bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

/**
 * Reads an installed Skill's directory back and digests it the same way
 * {@link hashSkillFiles} digested what was written.
 *
 * @remarks
 * Reading the directory rather than trusting the lockfile is the whole
 * point: the two disagreeing is exactly the local modification this is for.
 * Paths are normalised to forward slashes so a digest taken on Windows
 * matches the one taken when the files were installed.
 *
 * @param directory - The Skill's installed directory.
 * @returns `sha256:<hex>`, or `null` when the directory does not exist.
 * @throws Error for a filesystem failure other than the directory not
 * existing.
 * @example
 * ```ts
 * const current = await hashInstalledSkill("/repo/.agents/skills/code-review");
 * ```
 */
export async function hashInstalledSkill(directory: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await listFilesRecursively(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  const files: SkillFile[] = [];
  for (const absolute of entries) {
    files.push({
      path: relative(directory, absolute).split(sep).join("/"),
      bytes: new Uint8Array(await readFile(absolute)),
    });
  }
  return hashSkillFiles(files);
}

/** Every file beneath `directory`, as absolute paths. Symlinked directories are not followed — an install writes none. */
async function listFilesRecursively(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await listFilesRecursively(absolute)));
    } else if (entry.isFile()) {
      found.push(absolute);
    }
  }
  return found;
}

/**
 * Decides how one installed Skill stands.
 *
 * @remarks
 * The order of the checks is the point. `missing` comes first because
 * nothing else is answerable without the files. `modified` comes before
 * `outdated` because it is the finding that costs a User work: a stale copy
 * can be replaced freely, while a locally-edited one must not be replaced
 * without being asked, and a Skill that is both should be reported as the
 * one that needs a decision.
 *
 * @param entry - The lockfile's record of the install.
 * @param installedHash - What the directory digests to now, or `null` when
 * it is gone (from {@link hashInstalledSkill}).
 * @param registryUpdatedAt - The Registry's current `updated_at`, or
 * `undefined` when it was not looked up — then a Skill can never read
 * `outdated`, only `current`.
 * @returns The Skill's status.
 * @example
 * ```ts
 * skillStatus(entry, await hashInstalledSkill(dir), skill.updated_at);
 * ```
 */
export function skillStatus(
  entry: LockfileEntry,
  installedHash: string | null,
  registryUpdatedAt: string | undefined,
): SkillStatus {
  if (installedHash === null) return "missing";
  if (installedHash !== entry.content_hash) return "modified";
  if (registryUpdatedAt !== undefined && registryUpdatedAt !== entry.registry_updated_at) return "outdated";
  return "current";
}

/** One Skill the lockfile records, as it actually stands right now. */
export interface InstalledSkill {
  name: string;
  entry: LockfileEntry;
  /** The canonical directory the Skill's files live in at this Scope. */
  directory: string;
  status: SkillStatus;
  /** The Registry's current `updated_at`, or `undefined` when it was not consulted or no longer has this Skill. */
  registryUpdatedAt: string | undefined;
}

/**
 * Answers the Registry's current `updated_at` for a Skill, or `undefined`
 * when it no longer has one by that name.
 *
 * @remarks
 * A callback rather than a client, so this package stays free of HTTP: the
 * CLI and the MCP server each already own a way to reach the Registry, and
 * neither should have to hand one to a module whose whole job is the
 * filesystem.
 *
 * `namespace` is the one the lockfile recorded, when it recorded one, so a
 * Skill is looked up as the party that named it rather than by a bare name
 * that might now resolve to someone else's (ADR-0042).
 */
export type RegistryLookup = (name: string, namespace: string | undefined) => Promise<string | undefined>;

/**
 * Reads what is installed at `scope` and works out how each Skill stands.
 *
 * @remarks
 * Two independent comparisons, which is what lets the four statuses mean
 * different things. The digest of the files on disk against the one recorded
 * at install time detects a *local* edit; the Registry's `updated_at`
 * against the one recorded detects a *remote* change. Neither needs
 * versioning to work (ADR-0002), and the digest keeps working when the
 * Registry cannot be reached at all.
 *
 * @param ctx - Project root, environment, and home directory to resolve against.
 * @param scope - Which Scope's lockfile to read.
 * @param lookup - How to ask the Registry for a Skill's current
 * `updated_at`, or `null` to skip the Registry entirely — then nothing can
 * read `outdated`, only `current`, `modified`, or `missing`.
 * @returns One entry per Skill the lockfile records, alphabetical by name.
 * @throws Error when the lockfile cannot be read, when a Skill's directory
 * cannot be digested for a reason other than not existing, or whatever
 * `lookup` throws.
 * @example
 * ```ts
 * const installed = await readInstalled(ctx, "project", (name) => currentUpdatedAt(name));
 * const stale = installed.filter((skill) => skill.status === "outdated");
 * ```
 */
export async function readInstalled(
  ctx: InstallContext,
  scope: Scope,
  lookup: RegistryLookup | null,
): Promise<InstalledSkill[]> {
  const lockfile = await readLockfile(resolveLockfilePath(scope, ctx), "");

  const names = Object.keys(lockfile.skills).sort((a, b) => a.localeCompare(b));
  return Promise.all(
    names.map(async (name) => {
      const entry = lockfile.skills[name] as LockfileEntry;
      // `null` for the Agent: only `agentDir` depends on it, and the
      // canonical directory — the one holding the files a digest is taken
      // over — never does (ADR-0022).
      const { canonicalTarget } = resolveInstallTarget(ctx, name, scope, null);
      const [installedHash, registryUpdatedAt] = await Promise.all([
        hashInstalledSkill(canonicalTarget),
        lookup ? lookup(name, entry.namespace) : Promise.resolve(undefined),
      ]);
      return {
        name,
        entry,
        directory: canonicalTarget,
        status: skillStatus(entry, installedHash, registryUpdatedAt),
        registryUpdatedAt,
      };
    }),
  );
}

/**
 * Records an install in the Scope's lockfile, replacing any earlier entry
 * for the same Skill.
 *
 * @param ctx - Project root and home directory, to place the lockfile.
 * @param scope - Which Scope's lockfile to write.
 * @param registry - The Registry the Skill came from. The one a Skill was
 * last installed from wins, so a lockfile carried between Registries names
 * the one its entries actually came from.
 * @param name - The Skill's name, as the Registry reports it.
 * @param entry - What to record.
 * @throws Error when the lockfile cannot be read or written.
 */
export async function recordInstall(
  ctx: Pick<InstallContext, "cwd" | "homeDir">,
  scope: Scope,
  registry: string,
  name: string,
  entry: LockfileEntry,
): Promise<void> {
  const path = resolveLockfilePath(scope, ctx);
  const lockfile = await readLockfile(path, registry);
  await writeLockfile(path, { ...lockfile, registry, skills: { ...lockfile.skills, [name]: entry } });
}

/**
 * Drops a Skill from the Scope's lockfile.
 *
 * @param ctx - Project root and home directory, to place the lockfile.
 * @param scope - Which Scope's lockfile to write.
 * @param name - The Skill to forget.
 * @returns Whether there was an entry to drop.
 * @throws Error when the lockfile cannot be read or written.
 */
export async function forgetInstall(
  ctx: Pick<InstallContext, "cwd" | "homeDir">,
  scope: Scope,
  name: string,
): Promise<boolean> {
  const path = resolveLockfilePath(scope, ctx);
  const lockfile = await readLockfile(path, "");
  if (!(name in lockfile.skills)) return false;

  const remaining = Object.fromEntries(Object.entries(lockfile.skills).filter(([key]) => key !== name));
  await writeLockfile(path, { ...lockfile, skills: remaining });
  return true;
}
