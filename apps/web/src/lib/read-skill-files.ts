import { SKILL_FILE_NAME, type SkillFile } from "@skillset/shared";

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
 * still where the Skill's name and description come from).
 */
export async function readDroppedFiles(items: DataTransferItemList): Promise<SkillFile[]> {
  const entries = Array.from(items)
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);

  if (entries.length === 1 && entries[0].isFile && isMarkdownFile(entries[0].name)) {
    const file = await readFileEntry(entries[0] as FileSystemFileEntry);
    return [{ path: SKILL_FILE_NAME, bytes: new Uint8Array(await file.arrayBuffer()) }];
  }

  const nested = await Promise.all(entries.map((entry) => readEntry(entry, entry.name)));
  return nested.flat();
}

/**
 * A folder chosen from a file dialog (`<input type="file" webkitdirectory>`)
 * — or, when a single markdown file was picked directly rather than through
 * that folder dialog, that file alone, renamed to `SKILL.md` (see
 * `readDroppedFiles`).
 *
 * @remarks
 * A file picked directly carries no `webkitRelativePath`; the folder dialog
 * sets one on every file, including one sitting at the chosen folder's own
 * root — that's what tells the two apart.
 */
export async function readPickedFiles(fileList: File[]): Promise<SkillFile[]> {
  const [only] = fileList;
  if (fileList.length === 1 && only && !only.webkitRelativePath && isMarkdownFile(only.name)) {
    return [{ path: SKILL_FILE_NAME, bytes: new Uint8Array(await only.arrayBuffer()) }];
  }

  const files = await Promise.all(
    fileList.map(async (file) => ({
      path: file.webkitRelativePath || file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  );
  return files;
}
