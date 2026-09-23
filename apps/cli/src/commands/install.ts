import {
  AGENT_IDS,
  AGENTS,
  extractSkillFiles,
  ResourceSubmittedSchema,
  SkillSchema,
  type AgentId,
  type Scope,
  type SkillBundle,
  type SkillFile,
} from "@in-org-quicko/skillset-shared";
import {
  hashInstalledSkill,
  hashSkillFiles,
  installSkill,
  isRepositoryUrl,
  readLockfile,
  readRepositorySkill,
  resolveInstallTarget,
  resolveLockfilePath,
  type LockfileEntry,
  type Progress,
  type WriteReport,
} from "@in-org-quicko/skillset-installer";
import { detectAgentId, recordInstall } from "./installed.js";
import { rethrowValidationError } from "../errors.js";
import { ApiError, downloadBinary, registryFetch, uploadArtifactFiles, type RegistryClient } from "../http.js";
import { openReadClient, type SessionDeps } from "../session.js";

/** One selectable Agent, as the searchable prompt shows it. */
export interface AgentChoice {
  id: AgentId;
  displayName: string;
}

export interface InstallDeps extends SessionDeps {
  cwd: string;
  homeDir: string;
  /** Whether a terminal is attached — decides whether a missing `--agent`/`--scope` can be prompted for. */
  isTTY: boolean;
  /**
   * Asks the User to choose one value from `choices`. Called only when `isTTY` is true and
   * the matching flag was omitted.
   */
  promptChoice(question: string, choices: readonly string[]): Promise<string>;
  /**
   * Asks the User to pick one Agent from the full list, searchably. Called only when
   * `isTTY` is true and `--agent` was omitted. The result is validated against the table.
   */
  promptAgent(choices: readonly AgentChoice[]): Promise<string>;
  /**
   * Shows progress through the slow network steps of an install from a URL —
   * the clone and the Submission. Absent under `--json`, where nothing may
   * write to stdout but the result. Always stopped before a prompt runs.
   */
  progress?: Progress;
}


export interface InstallOptions {
  /** A Skill's name at the Registry, or a GitHub or GitLab URL to install straight from (ADR-0044). */
  name: string;
  /**
   * `--name`: which Skill to install out of a URL, by the name its `SKILL.md`
   * declares. Required with a URL, refused without one.
   */
  skillName?: string;
  /** Which party named it, when a bare name matches more than one (ADR-0042). */
  namespace?: string;
  agent?: string;
  scope?: string;
  /** `--copy`: write the Skill into the Agent's own directory rather than symlinking to `.agents/skills`. */
  copy?: boolean;
  /** `--force`: install over a locally-modified copy, or one a different party named, replacing it. */
  force?: boolean;
}

/**
 * Refuses to install over a Skill of the same name that a different party
 * named.
 *
 * @remarks
 * A project holds one `.agents/skills/<name>` however many Namespaces publish
 * that name (ADR-0022, ADR-0042), so this is the one collision a Namespace
 * cannot resolve — it makes two same-named Skills co-publishable, never
 * co-installable. Overwriting silently would swap a Skill the team wrote for a
 * stranger's, under a name that did not change, which nothing downstream would
 * show.
 *
 * Only an entry that recorded a Namespace can be judged: one written before
 * they existed reads as unknown and is left alone, the same way an
 * un-digested directory is.
 */
async function refuseIfDifferentlyNamed(
  deps: InstallDeps,
  scope: Scope,
  skillName: string,
  namespace: string,
  registry: string,
): Promise<void> {
  const lockfile = await readLockfile(resolveLockfilePath(scope, deps), registry);
  const recorded = lockfile.skills[skillName];
  if (!recorded?.namespace || recorded.namespace === namespace) return;

  throw new Error(
    `${skillName} is already installed from ${recorded.namespace}, and a project holds one Skill of a name. ` +
      `Pass --force to replace it with the one from ${namespace}.`,
  );
}

/**
 * Refuses to overwrite a Skill that has been edited since it was installed.
 *
 * @remarks
 * Only a Skill the lockfile *recorded* can be judged: without a digest from
 * install time there is nothing to compare against, so a directory that
 * arrived some other way is left to the install to replace as it always
 * did. The check is worth having anyway, because the case it catches — a
 * User's own edits to a Skill they installed — is both the common one and
 * the unrecoverable one (ADR-0002: no versions to restore from).
 */
async function refuseIfLocallyModified(
  deps: InstallDeps,
  scope: Scope,
  skillName: string,
  registry: string,
): Promise<void> {
  const lockfile = await readLockfile(resolveLockfilePath(scope, deps), registry);
  const recorded = lockfile.skills[skillName];
  if (!recorded) return;

  const { canonicalTarget } = resolveInstallTarget({ cwd: deps.cwd, env: deps.env, homeDir: deps.homeDir }, skillName, scope, null);
  const installedHash = await hashInstalledSkill(canonicalTarget);
  if (installedHash === null || installedHash === recorded.content_hash) return;

  throw new Error(
    `${skillName} has local changes at ${canonicalTarget}. Pass --force to replace it and discard them.`,
  );
}

const SCOPES: readonly Scope[] = ["project", "user"];

/** The full Agent list handed to the searchable prompt. */
export const AGENT_CHOICES: readonly AgentChoice[] = AGENTS.map((agent) => ({ id: agent.id, displayName: agent.displayName }));

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

/** Narrows a flag or prompt answer to one of a fixed list, naming the whole list when it isn't. */
function parseChoice<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!isOneOf(value, allowed)) {
    throw new Error(`Unknown ${label} "${value}" — choose from: ${allowed.join(", ")}.`);
  }
  return value;
}

const parseScope = (value: string): Scope => parseChoice(value, SCOPES, "scope");
const parseAgentId = (value: string): AgentId => parseChoice(value, AGENT_IDS, "Agent");

/** What became of putting a Skill installed from a URL forward for the Registry (ADR-0044). */
export type SubmissionOutcome =
  | { status: "submitted"; id: string }
  | { status: "already-published" }
  | { status: "not-logged-in" }
  | { status: "failed"; message: string };

export interface InstallReport extends WriteReport {
  /** Present only for an install from a URL. */
  submission?: SubmissionOutcome;
}

/** A Skill ready to write, whichever of the two places it came from. */
interface ResolvedSkill {
  name: string;
  namespace: string;
  files: SkillFile[];
  /** What the lockfile records about where it came from. */
  origin: Pick<LockfileEntry, "id" | "registry_updated_at" | "source">;
  /** Present only for an install from a URL, which is what gets submitted. */
  bundle?: SkillBundle;
}

/**
 * Resolves and downloads a Skill from the Registry.
 *
 * @remarks
 * The Artifact is inspected before a single byte is written, because this is
 * the only place a hostile one is stopped (ADR-0001).
 */
async function resolveFromRegistry(client: RegistryClient, options: InstallOptions): Promise<ResolvedSkill> {
  // The Namespace travels as a query parameter, not more path segments: it may
  // itself contain a slash and is compared whole (ADR-0042). Omitted, the
  // Registry resolves a bare name — the only candidate, or the one published
  // there — and answers 409 only on a genuine tie, which `describeError`
  // reprints with both Namespaces named.
  const query = options.namespace ? `?namespace=${encodeURIComponent(options.namespace)}` : "";
  const skill = await registryFetch(
    client,
    `/resources/skill/by-name/${encodeURIComponent(options.name)}${query}`,
    SkillSchema,
  );
  const bytes = await downloadBinary(client, `/resources/${skill.id}/artifact?source=cli`);

  let files;
  try {
    files = extractSkillFiles(bytes);
  } catch (error) {
    rethrowValidationError(error);
  }

  return {
    name: skill.name,
    namespace: skill.namespace,
    files,
    origin: { id: skill.id, registry_updated_at: skill.updated_at },
  };
}

/** Reads the named Skill out of a repository, recording it as from there rather than the Registry. */
async function resolveFromUrl(
  url: string,
  env: NodeJS.ProcessEnv,
  skillName: string,
  progress?: Progress,
): Promise<ResolvedSkill> {
  const { bundle, namespace } = await readRepositorySkill(url, skillName, env, progress);
  return {
    name: bundle.name,
    namespace,
    files: bundle.files,
    origin: { id: null, registry_updated_at: null, source: bundle.request.source },
    bundle,
  };
}

/**
 * Puts a Skill installed from a URL forward for an Admin to approve into the
 * Registry (ADR-0044).
 *
 * @remarks
 * Never throws: the Skill is already installed by the time this runs, and a
 * refused or unreachable Submission is reported alongside that success rather
 * than turning it into a failure.
 */
async function submitForApproval(client: RegistryClient, bundle: SkillBundle): Promise<SubmissionOutcome> {
  if (!client.token) return { status: "not-logged-in" };
  try {
    const submitted = await registryFetch(
      client,
      `/submissions/skill/${encodeURIComponent(bundle.name)}`,
      ResourceSubmittedSchema,
      { method: "PUT", body: JSON.stringify(bundle.request) },
    );
    await uploadArtifactFiles(client.fetch, submitted.upload.files, bundle.files);
    return { status: "submitted", id: submitted.submission.id };
  } catch (error) {
    if (error instanceof ApiError && error.code === "already_published") return { status: "already-published" };
    return { status: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Installs a Skill — from the Registry by name, or straight from a GitHub or
 * GitLab URL — always into the canonical `.agents/skills` directory,
 * symlinking the chosen Agent's own directory to it where they differ
 * (ADR-0022).
 *
 * @param deps - The fetch implementation, config-file path, environment, project root,
 * home directory, whether a terminal is attached, and how to prompt when a flag is missing.
 * @param options - The Skill's name or a repository URL, plus `--namespace`, `--agent`,
 * `--scope`, `--copy`, and `--force` when given, and `--name`, which a URL requires.
 * @returns Where the Skill's files were written, the Agent chosen, how its directory
 * was linked, and — for a URL — what became of submitting it for approval.
 * @throws Error when no Registry is configured; when `--scope` is missing and no terminal is
 * attached, so there is nothing to prompt and nothing to default to; when `--agent` or
 * `--scope` names something unknown; when a URL is given without `--name` or with
 * `--namespace`, or `--name` is given without a URL; when git cannot clone the URL, it holds
 * no Skill, or `--name` matches none of its Skills; or, naming the rule, when the Skill fails
 * inspection.
 * @throws ApiError when the Registry has no Skill by that name, or refuses the download.
 * @throws RegistryUnreachableError when the Registry cannot be reached.
 *
 * @remarks
 * Reads need no Token (ADR-0013), so a Registry install works against a Registry the User
 * has never logged in to. Everything that can fail without the network — the terminal check
 * and the flags — is checked first, matching publish's local-validation-first behaviour.
 * When `--agent` is omitted and no terminal is attached, the Agent is detected from the
 * environment and the project's Agent directories (the same ladder the MCP server uses); an
 * unresolved detection installs into `.agents/skills` and links nothing.
 *
 * A URL is cloned with the User's own git, so a private repository they can clone installs
 * too (ADR-0044). It is recorded in the lockfile with its Source and no Registry revision,
 * and — when a Token is configured — submitted for an Admin to approve. Once approved, the
 * Registry reports a revision, the Skill reads `outdated`, and `skillset update` moves it
 * onto the Registry's copy.
 *
 * @example
 * ```ts
 * await runInstall(deps, { name: "code-review", agent: "claude-code", scope: "project" });
 * await runInstall(deps, { name: "https://github.com/acme/skills", skillName: "pdf", scope: "project" });
 * ```
 */
export async function runInstall(deps: InstallDeps, options: InstallOptions): Promise<InstallReport> {
  const client = await openReadClient(deps);

  if (!options.scope && !deps.isTTY) {
    throw new Error("Not a terminal — pass --scope.");
  }

  const flagScope = options.scope ? parseScope(options.scope) : null;
  const flagAgent = options.agent ? parseAgentId(options.agent) : null;
  const fromUrl = isRepositoryUrl(options.name);
  if (fromUrl && options.namespace) {
    throw new Error("--namespace names a Skill at the Registry; a URL already says which repository it came from.");
  }
  if (fromUrl && !options.skillName) {
    throw new Error("Pass --name with a URL to say which Skill to install — the name in its SKILL.md.");
  }
  if (!fromUrl && options.skillName) {
    throw new Error("--name picks a Skill out of a repository URL; to install from the Registry, pass the name itself.");
  }

  const skill =
    fromUrl && options.skillName
      ? await resolveFromUrl(options.name, deps.env, options.skillName, deps.progress)
      : await resolveFromRegistry(client, options);

  // Agent before Scope, matching the ticket's prompt order. With no flag and no terminal, the
  // Agent is detected rather than prompted for.
  const agentId: AgentId | null = flagAgent ?? (deps.isTTY ? parseAgentId(await deps.promptAgent(AGENT_CHOICES)) : detectAgentId(deps));
  const scope = flagScope ?? parseScope(await deps.promptChoice("Install for which scope?", SCOPES));

  if (!options.force) {
    await refuseIfDifferentlyNamed(deps, scope, skill.name, skill.namespace, client.registry);
    await refuseIfLocallyModified(deps, scope, skill.name, client.registry);
  }

  const report = await installSkill({ cwd: deps.cwd, env: deps.env, homeDir: deps.homeDir }, skill.name, skill.files, scope, agentId, {
    copy: options.copy ?? false,
  });

  await recordInstall(deps, scope, client.registry, skill.name, {
    ...skill.origin,
    namespace: skill.namespace,
    content_hash: hashSkillFiles(skill.files),
    installed_at: new Date().toISOString(),
  });

  if (!skill.bundle) return report;
  if (client.token) deps.progress?.start("Submitting to the Registry");
  const submission = await submitForApproval(client, skill.bundle);
  if (client.token) deps.progress?.stop(submission.status === "failed" ? "Submission failed" : "Submission done");
  return { ...report, submission };
}
