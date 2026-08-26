import { unzipSync } from "fflate";
import { ARTIFACT_MAX_ENTRIES, ARTIFACT_MAX_UNCOMPRESSED_BYTES, stripWrappingDirectory, type SkillFile } from "./artifact.js";
import { SkillValidationError } from "./skill-rules.js";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const UNIX_HOST_OS = 3;
const S_IFMT = 0xf000;
const S_IFLNK = 0xa000;
const MAX_COMMENT_LENGTH = 65535;

/**
 * Finds the End Of Central Directory record by scanning backward for its signature,
 * bounded by the maximum possible zip comment length (PKZIP APPNOTE 4.3.16).
 */
function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView): number {
  const minOffset = Math.max(0, bytes.length - 22 - MAX_COMMENT_LENGTH);
  for (let offset = bytes.length - 22; offset >= minOffset; offset--) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

/**
 * The names of every entry whose Unix mode (in the central directory's *external file
 * attributes*) is a symlink. `fflate`'s `unzipSync` exposes no per-entry attributes at
 * all (`UnzipFileInfo` has only name/size/compression — PKZIP APPNOTE 4.4.15/4.5), so a
 * crafted symlink entry — target-path text stored as "file content", with the Unix
 * S_IFLNK bit set on the entry — is otherwise invisible to it. External attributes only
 * mean a Unix mode when "version made by"'s host-OS byte says so (byte 5 of the record);
 * anything else (DOS/FAT, etc.) is a different, unrelated bit layout and is skipped.
 */
function findSymlinkEntries(bytes: Uint8Array, view: DataView): Set<string> {
  const eocdOffset = findEndOfCentralDirectory(bytes, view);
  if (eocdOffset === -1) {
    throw new SkillValidationError("corrupt_archive", "Not a valid zip archive.");
  }

  const centralDirOffset = view.getUint32(eocdOffset + 16, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const decoder = new TextDecoder();
  const symlinks = new Set<string>();

  let offset = centralDirOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_DIR_SIGNATURE) {
      throw new SkillValidationError("corrupt_archive", "Not a valid zip archive.");
    }

    const hostOs = bytes[offset + 5];
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const externalAttrs = view.getUint32(offset + 38, true);

    if (hostOs === UNIX_HOST_OS && ((externalAttrs >>> 16) & S_IFMT) === S_IFLNK) {
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      symlinks.add(name);
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return symlinks;
}

function validateEntryName(name: string): void {
  if (name.includes("\0")) {
    throw new SkillValidationError("entry_null_byte", `Artifact entry "${name}" contains a null byte.`);
  }
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    throw new SkillValidationError("entry_absolute_path", `Artifact entry "${name}" is an absolute path.`);
  }
  if (name.split("/").includes("..")) {
    throw new SkillValidationError("entry_path_traversal", `Artifact entry "${name}" has a parent-directory segment.`);
  }
}

/**
 * The only place an incoming Artifact is inspected (ADR-0001 — the API never does):
 * unzips it, refuses path traversal, absolute paths, drive letters, null bytes, and
 * symlink entries, enforces the same entry-count and uncompressed-size limits publishing
 * does, and tolerates/rejects a wrapping directory the same way `buildSkillBundle` does.
 */
export function planExtraction(zipBytes: Uint8Array): SkillFile[] {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const symlinkNames = findSymlinkEntries(zipBytes, view);

  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(zipBytes);
  } catch {
    throw new SkillValidationError("corrupt_archive", "Not a valid zip archive.");
  }

  const names = Object.keys(unzipped).filter((name) => !name.endsWith("/"));
  if (names.length > ARTIFACT_MAX_ENTRIES) {
    throw new SkillValidationError(
      "too_many_entries",
      `A Skill holds at most ${ARTIFACT_MAX_ENTRIES} files; this one has ${names.length}.`,
    );
  }

  const files: SkillFile[] = names.map((name) => {
    validateEntryName(name);
    if (symlinkNames.has(name)) {
      throw new SkillValidationError("entry_symlink", `Artifact entry "${name}" is a symlink.`);
    }
    return { path: name, bytes: unzipped[name]! };
  });

  const uncompressed = files.reduce((total, file) => total + file.bytes.byteLength, 0);
  if (uncompressed > ARTIFACT_MAX_UNCOMPRESSED_BYTES) {
    throw new SkillValidationError(
      "uncompressed_too_large",
      `A Skill's files come to at most ${ARTIFACT_MAX_UNCOMPRESSED_BYTES} bytes uncompressed; these come to ${uncompressed}.`,
    );
  }

  return stripWrappingDirectory(files);
}
