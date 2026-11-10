import {
  extractArtifactFiles,
  SUBAGENT_AGENT_ID,
  subagentFileName,
  SubagentSchema,
  type Scope,
} from "@in-org-quicko/skillset-shared";
import {
  hashInstalledSubagent,
  hashSkillFiles,
  installSubagent,
  readLockfile,
  recordInstall,
  resolveLockfilePath,
  resolveSubagentTarget,
  type InstallContext,
  type WriteReport,
} from "@in-org-quicko/skillset-installer";
import { rethrowValidationError } from "../errors.js";
import { downloadBinary, registryFetch, type RegistryClient } from "../http.js";

/** Which Subagent to fetch and where to put it. */
export interface SubagentInstallRequest {
  name: string;
  /** Which party named it, when a bare name matches more than one (ADR-0042). */
  namespace?: string;
  scope: Scope;
  /** Replace a file that was edited, that nothing recorded, or that a different party named. */
  force?: boolean;
}

/**
 * Refuses to replace a Subagent file the developer owns (ADR-0047).
 *
 * @throws Error when a file is already there and the lockfile does not record
 * it, records it from a different Namespace, or records different contents.
 */
async function refuseIfNotOurs(ctx: InstallContext, registry: string, name: string, namespace: string, scope: Scope): Promise<void> {
  const target = resolveSubagentTarget(ctx, name, scope);
  const installedHash = await hashInstalledSubagent(target, name);
  if (installedHash === null) return;

  const lockfile = await readLockfile(resolveLockfilePath(scope, ctx), registry);
  const recorded = lockfile.subagents?.[name];
  if (!recorded) {
    throw new Error(`${target} already exists and was not installed by skillset. Pass --force to replace it.`);
  }
  if (recorded.namespace && recorded.namespace !== namespace) {
    throw new Error(`${name} is already installed from ${recorded.namespace}. Pass --force to replace it with the one from ${namespace}.`);
  }
  if (installedHash !== recorded.content_hash) {
    throw new Error(`${name} has local changes at ${target}. Pass --force to replace it and discard them.`);
  }
}

/**
 * Downloads a Subagent from the Registry and writes its one file into Claude
 * Code's agents directory, recording it in the lockfile (ADR-0047).
 *
 * @param ctx - Project root, environment, and home directory.
 * @param client - A Registry client; reads need no Token (ADR-0013).
 * @param request - The Subagent's name, optional Namespace, Scope, and `force`.
 * @returns Where the file was written, in the shape a Skill install reports.
 * @throws ApiError when the Registry has no Subagent by that name.
 * @throws Error naming the rule when the Artifact fails inspection, when it
 * does not hold `<name>.md`, or when an existing file is not ours to replace
 * and `force` was not passed.
 * @example
 * ```ts
 * await installSubagentFromRegistry(ctx, client, { name: "code-reviewer", scope: "project" });
 * ```
 */
export async function installSubagentFromRegistry(
  ctx: InstallContext,
  client: RegistryClient,
  request: SubagentInstallRequest,
): Promise<WriteReport> {
  const query = request.namespace ? `?namespace=${encodeURIComponent(request.namespace)}` : "";
  const subagent = await registryFetch(
    client,
    `/resources/subagent/by-name/${encodeURIComponent(request.name)}${query}`,
    SubagentSchema,
  );
  const bytes = await downloadBinary(client, `/resources/${subagent.id}/artifact?source=cli`);

  let files;
  try {
    files = extractArtifactFiles(bytes);
  } catch (error) {
    rethrowValidationError(error);
  }
  const fileName = subagentFileName(subagent.name);
  const file = files.find((candidate) => candidate.path === fileName);
  if (!file) throw new Error(`${subagent.name}'s Artifact does not hold ${fileName} — it may not have finished uploading.`);

  if (!request.force) await refuseIfNotOurs(ctx, client.registry, subagent.name, subagent.namespace, request.scope);

  const path = await installSubagent(ctx, subagent.name, file.bytes, request.scope);
  await recordInstall(
    ctx,
    request.scope,
    client.registry,
    subagent.name,
    {
      id: subagent.id,
      namespace: subagent.namespace,
      registry_updated_at: subagent.updated_at,
      content_hash: hashSkillFiles([file]),
      installed_at: new Date().toISOString(),
    },
    "subagent",
  );
  return { skillDirectory: path, agent: SUBAGENT_AGENT_ID, link: { kind: "canonical" }, alsoServes: [] };
}
