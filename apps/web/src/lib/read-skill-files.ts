import {
  extractSkillFiles,
  isSkillArchiveName,
  SKILL_FILE_NAME,
  type SkillFile,
} from "@in-org-quicko/skillset-shared";

const MARKDOWN_EXTENSIONS = [".md", ".markdown"];

/** Whether `name` names a markdown file, by extension. */
function isMarkdownFile(name: string): boolean {
  return MARKDOWN_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension));
}

async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  // A directory reader can return entries in batches (Chrome caps a single
  // call around 100) — keep calling until an empty batch signals the end.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

function readFileEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function readEntry(entry: FileSystemEntry, path: string): Promise<SkillFile[]> {
  if (entry.isFile) {
    const file = await readFileEntry(entry as FileSystemFileEntry);
    return [{ path, bytes: new Uint8Array(await file.arrayBuffer()) }];
  }
  const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
  const nested = await Promise.all(children.map((child) => readEntry(child, `${path}/${child.name}`)));
  return nested.flat();
}

/**
 * A folder dropped onto the publish screen, read in full including nested
 * directories — or, when what was dropped is a single markdown file rather
 * than a folder, that file alone, renamed to `SKILL.md` so it feeds the same
 * publishing pipeline a folder's own `SKILL.md` would (its frontmatter is
 * still where the Skill's name and description come from). A single `.skill`
 * file is unpacked into the files it holds, as `readSkillArchive` does.
 *
 * @throws SkillValidationError when a dropped `.skill` file is not a safe,
 * well-formed Skill archive (see `extractSkillFiles`).
 */
export async function readDroppedFiles(items: DataTransferItemList): Promise<SkillFile[]> {
  const entries = Array.from(items)
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);

  if (entries.length === 1 && entries[0].isFile && isMarkdownFile(entries[0].name)) {
    const file = await readFileEntry(entries[0] as FileSystemFileEntry);
    return [{ path: SKILL_FILE_NAME, bytes: new Uint8Array(await file.arrayBuffer()) }];
  }

  if (entries.length === 1 && entries[0].isFile && isSkillArchiveName(entries[0].name)) {
    return readSkillArchive(await readFileEntry(entries[0] as FileSystemFileEntry));
  }

  const nested = await Promise.all(entries.map((entry) => readEntry(entry, entry.name)));
  return nested.flat();
}

/**
 * A `.skill` file — a zip archive of a Skill — unpacked into its files.
 *
 * @remarks
 * Goes through `extractSkillFiles`, the one place an archive is inspected, so
 * a `.skill` upload is held to the same limits as an installed Artifact: no
 * path traversal, absolute paths or symlinks, bounded size and entry count,
 * and a `SKILL.md` required. A single wrapping directory is stripped.
 *
 * @param file - The chosen or dropped `.skill` file.
 * @returns The Skill's files, at paths relative to its root.
 * @throws SkillValidationError when the archive is corrupt, hostile, over a
 * limit, or holds no `SKILL.md`.
 */
export async function readSkillArchive(file: File): Promise<SkillFile[]> {
  return extractSkillFiles(new Uint8Array(await file.arrayBuffer()));
}

/**
 * A folder chosen from the publish form's folder dialog
 * (`<input type="file" webkitdirectory>`), read via each file's
 * `webkitRelativePath` — Chrome sets one on every file the dialog returns,
 * including one sitting at the chosen folder's own root.
 *
 * @remarks
 * A single markdown file can't be picked through this dialog (folder-picking
 * mode shows no files at all, by design) — that case is drag-and-drop only,
 * via `readDroppedFiles`.
 */
export async function readPickedFiles(fileList: File[]): Promise<SkillFile[]> {
  return Promise.all(
    fileList.map(async (file) => ({
      path: file.webkitRelativePath || file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  );
}
