import type { SkillFile } from "@skill-registry/shared";

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

/** A folder dropped onto the publish screen, read in full including nested directories. */
export async function readDroppedFiles(items: DataTransferItemList): Promise<SkillFile[]> {
  const entries = Array.from(items)
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);
  const nested = await Promise.all(entries.map((entry) => readEntry(entry, entry.name)));
  return nested.flat();
}

/** A folder chosen from a file dialog (`<input type="file" webkitdirectory>`). */
export async function readPickedFiles(fileList: FileList): Promise<SkillFile[]> {
  const files = await Promise.all(
    Array.from(fileList).map(async (file) => ({
      path: file.webkitRelativePath || file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  );
  return files;
}
