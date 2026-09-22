import { ArtifactManifestSchema, SkillSchema, type ArtifactFile, type Skill } from "@in-org-quicko/skillset-shared";
import { ApiError, registryFetch } from "../http.js";
import { openReadClient, type SessionDeps } from "../session.js";

export interface InfoOptions {
  name: string;
  /** `--files`: also list what the Skill ships, which costs a second request. */
  files?: boolean;
}

/** One Skill as `skillset info` reports it. */
export interface InfoReport {
  skill: Skill;
  /** Every file the Skill ships, or `null` when `--files` was not asked for. */
  files: ArtifactFile[] | null;
}

/**
 * Reads one Skill from the Registry without installing it.
 *
 * @param deps - The fetch implementation, config-file path, and environment
 * to resolve the Registry from.
 * @param options - The Skill's name, and `--files` to list its contents too.
 * @returns The Skill, and its file list when asked for.
 * @throws ApiError naming `skillset search` when the Registry has no Skill by
 * that name — someone who mistyped needs the catalog, not a bare 404, and the
 * 404's own code is kept so `--json` can still report it as `not_found`.
 * @throws ApiError when the Registry refuses for any other reason.
 * @throws RegistryUnreachableError when the Registry cannot be reached.
 *
 * @remarks
 * Reading and adopting are different decisions, and one should not require
 * the other: before this, seeing what a Skill actually said meant installing
 * it and reading the files it wrote into your project.
 *
 * Records no Install. Neither request is one — reading metadata never was,
 * and listing an Artifact's files is explicitly not obtaining it (ADR-0028).
 * Only the zip endpoint counts, and nothing here touches it.
 *
 * The file list is behind `--files` rather than always fetched, because it
 * is a second round-trip for something most reads do not want. When it is
 * fetched it reports what storage actually holds rather than what was
 * declared at publish time, so a partially-uploaded Artifact reads as the
 * short list it really is (ADR-0032).
 *
 * Reads need no Token (ADR-0013).
 *
 * @example
 * ```ts
 * const { skill } = await runInfo(deps, { name: "code-review" });
 * console.log(skill.body);
 * ```
 */
export async function runInfo(deps: SessionDeps, options: InfoOptions): Promise<InfoReport> {
  const client = await openReadClient(deps);

  let skill: Skill;
  try {
    skill = await registryFetch(client, `/resources/skill/by-name/${encodeURIComponent(options.name)}`, SkillSchema);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      // Rethrown as an ApiError rather than a plain Error so the Registry's own
      // code survives the friendlier message: under `--json` that is what a
      // caller branches on, and `cli_error` would make the commonest failure
      // here indistinguishable from a local one.
      throw new ApiError(
        error.status,
        error.code,
        `No Skill named "${options.name}" on this Registry. Run \`skillset search\` to see what there is.`,
      );
    }
    throw error;
  }

  if (!options.files) return { skill, files: null };

  const manifest = await registryFetch(client, `/resources/${skill.id}/files`, ArtifactManifestSchema);
  return { skill, files: manifest.files };
}
