import {
  buildPluginBundle,
  type SkillFile,
  type SkillSourceLocation,
} from "@in-org-quicko/skillset-shared";

/**
 * Finds the folder in a repository that holds the Plugin named `name`, and reads it.
 *
 * @remarks
 * An Imported Plugin records only its repository (ADR-0041), not the folder
 * inside it, so the folder is found again by the name in its manifest.
 * Folders named after the Plugin, then the repository root, are read first,
 * so a repository laid out the usual way costs one read. A folder that fails
 * to read or is not a valid Plugin is skipped.
 *
 * @param locations - Every Plugin folder found in the repository, from `discoverSkillSources`.
 * @param read - Reads one folder's files, e.g. `fetchSkillFilesAt`.
 * @param name - The Plugin's name.
 * @returns The files of the folder whose manifest names `name`.
 * @throws Error when no folder's manifest names `name`.
 * @example
 * ```ts
 * const files = await findPluginFiles(await discoverSkillSources(source, "plugin"), fetchSkillFilesAt, "review-suite");
 * ```
 */
export async function findPluginFiles(
  locations: readonly SkillSourceLocation[],
  read: (location: SkillSourceLocation) => Promise<SkillFile[]>,
  name: string,
): Promise<SkillFile[]> {
  const rank = (location: SkillSourceLocation) =>
    location.path.split("/").at(-1) === name ? 0 : location.path === "" ? 1 : 2;
  for (const location of [...locations].sort((a, b) => rank(a) - rank(b))) {
    try {
      const files = await read(location);
      if (buildPluginBundle(files).name === name) return files;
    } catch {
      // Not this folder; try the next.
    }
  }
  throw new Error(`No plugin named "${name}" was found in the repository it was imported from.`);
}
