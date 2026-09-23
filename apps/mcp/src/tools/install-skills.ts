import { access } from "node:fs/promises";
import {
  extractSkillFiles,
  formatSkillValidationError,
  ArtifactManifestSchema,
  type AgentDetection,
  type AgentId,
  SkillSchema,
  SkillValidationError,
  type ArtifactManifest,
  type Scope,
  type Skill,
} from "@in-org-quicko/skillset-shared";
import {
  hashInstalledSkill,
  hashSkillFiles,
  installSkill,
  readLockfile,
  recordInstall,
  resolveInstallTarget,
  resolveLockfilePath,
  skillStatus,
  type InstallContext,
  type LinkResult,
} from "@in-org-quicko/skillset-installer";

/** The project root, environment, and home directory an install is resolved and written against. */
export type InstallSkillsContext = InstallContext;

export interface InstallSkillsDeps {
  fetchImpl: typeof fetch;
  registry: string;
  ctx: InstallSkillsContext;
  scope: Scope;
  /** The resolved Agent and the rung that resolved it — `agentId: null` installs canonically and links nothing. */
  detection: AgentDetection;
  /** Replace an already-installed Skill completely, rather than refusing. */
  overwrite: boolean;
}

/** {@link installSkills}'s result: the Agent detection that governed the batch, and one outcome per Skill. */
export interface InstallSkillsResult {
  detection: AgentDetection;
  outcomes: InstallSkillOutcome[];
}

/** One Skill's outcome from {@link installSkills}. */
export type InstallSkillOutcome =
  | {
      name: string;
      status: "installed";
      skillDirectory: string;
      link: LinkResult;
      alsoServes: AgentId[];
      skillMdBody: string;
      note: string;
    }
  | {
      name: string;
      status: "fallback";
      artifactLocation: string;
      manifest: ArtifactManifest;
      intendedDirectory: string;
      skillMdBody: string;
    }
  | { name: string; status: "refused"; existing: string; installed: ExistingCopyStatus }
  | { name: string; status: "error"; message: string };

/**
 * How the copy already on disk stands, reported alongside a refusal so the
 * caller knows what overwriting it would cost.
 *
 * The four {@link SkillStatus} values minus `missing` — which cannot arise
 * here, because a refusal only happens when the directory exists — plus
 * `untracked` for a directory the lockfile has no entry for. `untracked` is
 * the cautious case: nothing recorded what was written, so nothing can say
 * whether replacing it discards work.
 */
export type ExistingCopyStatus = "current" | "outdated" | "modified" | "untracked";

/** Resolves a Skill by name. @throws Error naming the Skill when the Registry answers non-2xx. */
async function fetchSkill(fetchImpl: typeof fetch, registry: string, name: string): Promise<Skill> {
  const res = await fetchImpl(new URL(`/api/resources/skill/by-name/${encodeURIComponent(name)}`, registry));
  if (!res.ok) {
    throw new Error(`Skill "${name}" was not found (status ${res.status}).`);
  }
  return SkillSchema.parse(await res.json());
}

/** Reads an Artifact's file list for the fallback branch — not a download, so records no Install (ADR-0028). @throws Error on a non-2xx response. */
async function fetchManifest(fetchImpl: typeof fetch, registry: string, id: string): Promise<ArtifactManifest> {
  const res = await fetchImpl(new URL(`/api/resources/${id}/files`, registry));
  if (!res.ok) {
    throw new Error(`Could not read the Artifact's file list (status ${res.status}).`);
  }
  return ArtifactManifestSchema.parse(await res.json());
}

/** Downloads an Artifact's bytes, recording one Install against the `mcp` source. @throws Error on a non-2xx response. */
async function downloadArtifact(fetchImpl: typeof fetch, registry: string, id: string): Promise<Uint8Array> {
  const res = await fetchImpl(new URL(`/api/resources/${id}/artifact?source=mcp`, registry));
  if (!res.ok) {
    throw new Error(`Downloading the Artifact failed (status ${res.status}).`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Turns a validation failure into a message naming the rule it broke; passes anything else through. */
function describeError(error: unknown): string {
  if (error instanceof SkillValidationError) {
    return formatSkillValidationError(error);
  }
  return error instanceof Error ? error.message : String(error);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decides how the copy already installed at `directory` stands, for a refusal
 * to report.
 *
 * @param ctx - The project root and home directory the lockfile is resolved against.
 * @param scope - Which Scope's lockfile records this install.
 * @param registry - The Registry URL, for reading a lockfile that has none yet.
 * @param name - The Skill's name, as the lockfile keys it.
 * @param directory - The canonical directory the installed files live in.
 * @param registryUpdatedAt - What the Registry holds now, already fetched for
 * this install — so deciding `outdated` costs no extra request.
 * @returns `untracked` when no lockfile entry records this Skill, and
 * otherwise whatever {@link skillStatus} makes of the two recorded signals.
 * @throws Error if the lockfile exists but cannot be read, or the installed
 * directory cannot be walked.
 *
 * @remarks
 * Exists because `refused` used to say only that something was already there.
 * That is the same answer for a copy identical to the Registry's, one the
 * Registry has moved past, and one somebody has edited — and those call for
 * three different next steps. A caller that cannot tell them apart either
 * gives up or passes `overwrite` blindly, and the second is how local edits
 * get discarded.
 *
 * `missing` is unreachable: the caller only asks once the directory exists.
 *
 * @example
 * ```ts
 * await describeExistingCopy(ctx, "project", registry, "code-review", dir, skill.updated_at);
 * // -> "modified"
 * ```
 */
async function describeExistingCopy(
  ctx: InstallSkillsContext,
  scope: Scope,
  registry: string,
  name: string,
  directory: string,
  registryUpdatedAt: string,
): Promise<ExistingCopyStatus> {
  const lockfile = await readLockfile(resolveLockfilePath(scope, ctx), registry);
  const entry = lockfile.skills[name];
  if (!entry) return "untracked";

  const status = skillStatus(entry, await hashInstalledSkill(directory), registryUpdatedAt);
  return status === "missing" ? "untracked" : status;
}

/**
 * Builds the result for an Agent with no directory at this Scope (spec, "Install Sequence"
 * step 8): nothing is written, and this reports enough — where the Artifact lives, what it
 * contains, where it would have gone, and its `SKILL.md` body — for the Skill to be read or
 * fetched some other way.
 *
 * A pure function of its arguments, kept separate from {@link installOneSkill} so the exact shape
 * of a fallback result is directly testable without needing a real Agent row with no
 * directory — the current hand-curated table (ADR-0031) has none.
 */
export function buildFallbackOutcome(
  name: string,
  skill: Skill,
  registry: string,
  intendedDirectory: string,
  manifest: ArtifactManifest,
): InstallSkillOutcome {
  return {
    name,
    status: "fallback",
    artifactLocation: new URL(`/api/resources/${skill.id}/artifact`, registry).toString(),
    manifest,
    intendedDirectory,
    skillMdBody: skill.body,
  };
}

/**
 * Runs the Install Sequence (spec) for one Skill: resolve, check for an existing install,
 * download, validate, and write — branching to the no-directory fallback right after
 * resolving the target, and to a refusal right before the download so a refused or
 * unresolvable Skill never reaches the network for its Artifact.
 */
async function installOneSkill(deps: InstallSkillsDeps, name: string): Promise<InstallSkillOutcome> {
  const { fetchImpl, registry, ctx, scope, overwrite } = deps;
  const agentId = deps.detection.agentId;

  let skill: Skill;
  try {
    skill = await fetchSkill(fetchImpl, registry, name);
  } catch (error) {
    return { name, status: "error", message: describeError(error) };
  }

  // `sanitizeSkillDirectoryName` (inside resolveInstallTarget) throwing on `skill.name` is not
  // reachable through this path today: `SkillSchema.parse`, above, already rejects a Skill
  // whose `name` fails `SKILL_NAME_PATTERN`, and every name that pattern accepts sanitises to
  // itself unchanged. Handled anyway, the same way installer's own `agentDir === null` branch
  // below is — defensively, without a forced test for a case real data can't produce.
  let target;
  try {
    target = resolveInstallTarget(ctx, skill.name, scope, agentId);
  } catch (error) {
    return { name, status: "error", message: describeError(error) };
  }

  if (target.agentDir === null) {
    let manifest: ArtifactManifest;
    try {
      manifest = await fetchManifest(fetchImpl, registry, skill.id);
    } catch (error) {
      return { name, status: "error", message: describeError(error) };
    }
    return buildFallbackOutcome(name, skill, registry, target.canonicalTarget, manifest);
  }

  if (!overwrite && (await pathExists(target.canonicalTarget))) {
    let installed: ExistingCopyStatus;
    try {
      installed = await describeExistingCopy(ctx, scope, registry, skill.name, target.canonicalTarget, skill.updated_at);
    } catch {
      // An unreadable lockfile or directory is not worth failing the refusal
      // over — the refusal itself still stands, and `untracked` is the
      // answer that asks the caller to check before overwriting.
      installed = "untracked";
    }
    return { name, status: "refused", existing: skill.name, installed };
  }

  let bytes: Uint8Array;
  try {
    bytes = await downloadArtifact(fetchImpl, registry, skill.id);
  } catch (error) {
    return { name, status: "error", message: describeError(error) };
  }

  let files;
  try {
    files = extractSkillFiles(bytes);
  } catch (error) {
    return { name, status: "error", message: describeError(error) };
  }

  const report = await installSkill(ctx, skill.name, files, scope, agentId, { copy: false });

  await recordInstall(ctx, scope, registry, skill.name, {
    id: skill.id,
    registry_updated_at: skill.updated_at,
    content_hash: hashSkillFiles(files),
    installed_at: new Date().toISOString(),
  });

  return {
    name,
    status: "installed",
    skillDirectory: report.skillDirectory,
    link: report.link,
    alsoServes: report.alsoServes,
    skillMdBody: skill.body,
    note: "Active from your next session — this one has not loaded it.",
  };
}

/**
 * Installs one or more Skills by name, entirely within the server process (spec, "Install
 * Sequence"): resolves each against the Registry, downloads and validates its Artifact,
 * stages it, and moves it into place — or, for an Agent with no directory at this Scope,
 * reports where it would have gone instead of failing.
 *
 * @param deps - The injected `fetch`, the Registry's URL, the project root/environment/home
 * directory to resolve and write paths against, the Scope, the resolved Agent `detection`,
 * and whether an existing install may be overwritten.
 * @param names - The Skill names to install, exactly as given to the tool.
 * @returns The governing Agent `detection` and one {@link InstallSkillOutcome} per entry in
 * `names`, in the same order. One Skill failing — an unknown name, a refused download, a bad
 * Artifact — never stops the rest of the batch.
 *
 * @remarks
 * Sends no `authorization` header on any request: this server holds no credential
 * (ADR-0013). Every downloaded Artifact is validated by `extractSkillFiles` before a single
 * byte is written (ADR-0001). Each install is recorded in the Scope's lockfile, which is
 * what later lets `installed_skills` and `update_skills` tell a stale copy from an edited
 * one. An existing install is left alone unless `deps.overwrite` is set, and that check
 * lives here in the tool handler rather than in the shared installer. It is stricter than
 * `skillset install`'s, deliberately: the CLI refuses only a copy someone has edited, while
 * this refuses any existing copy, because an Agent reinstalling on its own initiative is a
 * weaker signal of intent than a person typing the command. The `detection` is echoed back
 * so the caller can report which Agent was chosen and which rung of the ladder chose it.
 *
 * @example
 * ```ts
 * const { detection, outcomes } = await installSkills(
 *   { fetchImpl: fetch, registry: "https://registry.example", ctx, scope: "project",
 *     detection: { agentId: "claude-code", step: "client-identity" }, overwrite: false },
 *   ["code-review", "typo-name"],
 * );
 * // -> outcomes: [{ name: "code-review", status: "installed", ... }, { name: "typo-name", status: "error", ... }]
 * ```
 */
export async function installSkills(deps: InstallSkillsDeps, names: readonly string[]): Promise<InstallSkillsResult> {
  const outcomes: InstallSkillOutcome[] = [];
  for (const name of names) {
    outcomes.push(await installOneSkill(deps, name));
  }
  return { detection: deps.detection, outcomes };
}
