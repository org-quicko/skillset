import type { ArtifactFile } from "@in-org-quicko/skillset-shared";

/** One folder of an Artifact: the folders and files directly inside it. The root's `path` is `""`. */
export interface FolderNode {
  name: string;
  path: string;
  folders: FolderNode[];
  files: ArtifactFile[];
}

/**
 * Nests an Artifact's flat file list into folders, one level per path segment.
 *
 * @remarks
 * Each folder lists its files before its subfolders, files in the order the
 * API listed them (it puts a Skill's `SKILL.md` first) and folders by name.
 *
 * @param files - The Artifact's files, at paths relative to its root.
 * @returns The root folder.
 * @example
 * ```ts
 * buildFileTree([{ path: "README.md", size: 1 }, { path: "skills/a/SKILL.md", size: 1 }]);
 * // -> root with file README.md and folder skills → a → SKILL.md
 * ```
 */
export function buildFileTree(files: readonly ArtifactFile[]): FolderNode {
  const root: FolderNode = { name: "", path: "", folders: [], files: [] };
  for (const file of files) {
    const segments = file.path.split("/");
    let folder = root;
    for (const name of segments.slice(0, -1)) {
      const path = folder.path ? `${folder.path}/${name}` : name;
      let child = folder.folders.find((candidate) => candidate.name === name);
      if (!child) {
        child = { name, path, folders: [], files: [] };
        folder.folders.push(child);
      }
      folder = child;
    }
    folder.files.push(file);
  }
  sortFolders(root);
  return root;
}

function sortFolders(folder: FolderNode): void {
  folder.folders.sort((a, b) => a.name.localeCompare(b.name));
  folder.folders.forEach(sortFolders);
}

/**
 * Every folder a path sits inside, outermost first — what must be open for it to show.
 *
 * @param path - A file's path.
 * @returns The folder paths, e.g. `["skills", "skills/a"]` for `skills/a/SKILL.md`.
 */
export function ancestorFolders(path: string): string[] {
  const segments = path.split("/").slice(0, -1);
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}
