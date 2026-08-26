import { unzipSync } from "fflate";
import {
  ARTIFACT_MAX_ENTRIES,
  ARTIFACT_MAX_TRANSFER_BYTES,
  ARTIFACT_MAX_UNCOMPRESSED_BYTES,
  stripWrappingDirectory,
  type SkillFile,
} from "./artifact.js";
import { SkillValidationError } from "./skill-rules.js";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const CENTRAL_DIR_HEADER_LENGTH = 46;
const UNIX_HOST_OS = 3;
const S_IFMT = 0xf000;
const S_IFLNK = 0xa000;
const MAX_COMMENT_LENGTH = 65535;
const ZIP64_SIZE_SENTINEL = 0xffffffff;

interface CentralDirectoryEntry {
  name: string;
  /** The size the archive *claims* it will expand to. Declared by the archive's author, so it bounds the work but does not prove it. */
  declaredSize: number;
  isSymlink: boolean;
}

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
 * Every entry the central directory declares, with its name, its declared uncompressed
 * size, and whether its Unix mode marks it a symlink.
 *
 * Reading the directory rather than the unzipped body is what lets the limits below be
 * enforced *before* anything is expanded. `fflate`'s `unzipSync` also exposes no
 * per-entry attributes at all (`UnzipFileInfo` has only name/size/compression — PKZIP
 * APPNOTE 4.4.15/4.5), so a crafted symlink entry — target-path text stored as "file
 * content", with the Unix S_IFLNK bit set on the entry — is otherwise invisible to it.
 * External attributes only mean a Unix mode when "version made by"'s host-OS byte says so
 * (byte 5 of the record); anything else (DOS/FAT, etc.) is a different, unrelated bit
 * layout and is skipped.
 */
function readCentralDirectory(bytes: Uint8Array, view: DataView): CentralDirectoryEntry[] {
  const eocdOffset = findEndOfCentralDirectory(bytes, view);
  if (eocdOffset === -1) {
    throw new SkillValidationError("corrupt_archive", "Not a valid zip archive.");
  }

  const centralDirOffset = view.getUint32(eocdOffset + 16, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const decoder = new TextDecoder();
  const entries: CentralDirectoryEntry[] = [];

  let offset = centralDirOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (offset + CENTRAL_DIR_HEADER_LENGTH > bytes.length || view.getUint32(offset, true) !== CENTRAL_DIR_SIGNATURE) {
      throw new SkillValidationError("corrupt_archive", "Not a valid zip archive.");
    }

    const hostOs = bytes[offset + 5];
    const declaredSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const externalAttrs = view.getUint32(offset + 38, true);
    const name = decoder.decode(bytes.subarray(offset + CENTRAL_DIR_HEADER_LENGTH, offset + CENTRAL_DIR_HEADER_LENGTH + nameLength));

    // A zip64 entry parks its real size in an extra field. Rather than grow a second size
    // parser for archives we never produce, refuse them — an unreadable declared size is
    // exactly the case the limits below exist to catch.
    if (declaredSize === ZIP64_SIZE_SENTINEL) {
      throw new SkillValidationError("unsupported_archive", `Artifact entry "${name}" uses zip64, which is not supported.`);
    }

    entries.push({
      name,
      declaredSize,
      isSymlink: hostOs === UNIX_HOST_OS && ((externalAttrs >>> 16) & S_IFMT) === S_IFLNK,
    });

    offset += CENTRAL_DIR_HEADER_LENGTH + nameLength + extraLength + commentLength;
  }

  return entries;
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

function enforceEntryCount(count: number): void {
  if (count > ARTIFACT_MAX_ENTRIES) {
    throw new SkillValidationError(
      "too_many_entries",
      `A Skill holds at most ${ARTIFACT_MAX_ENTRIES} files; this one has ${count}.`,
    );
  }
}

function enforceUncompressedSize(total: number): void {
  if (total > ARTIFACT_MAX_UNCOMPRESSED_BYTES) {
    throw new SkillValidationError(
      "uncompressed_too_large",
      `A Skill's files come to at most ${ARTIFACT_MAX_UNCOMPRESSED_BYTES} bytes uncompressed; these come to ${total}.`,
    );
  }
}

/**
 * Unpacks a downloaded Artifact into the files that will be written to disk.
 *
 * This is the only place an incoming Artifact is inspected (ADR-0001 — the API never
 * does), so it is where a hostile one is stopped: it refuses path traversal, absolute
 * paths, drive letters, null bytes, and symlink entries, enforces the same transfer,
 * entry-count and uncompressed-size limits publishing does, and tolerates or rejects a
 * wrapping directory exactly the way `buildSkillBundle` does.
 *
 * @param zipBytes - The Artifact as downloaded from storage.
 * @returns The Skill's files, with any single wrapping directory stripped from their paths.
 * @throws SkillValidationError with rule `corrupt_archive` when the bytes are not a
 * readable zip, `unsupported_archive` for zip64, `too_many_entries` or
 * `uncompressed_too_large` when a limit is exceeded, `artifact_too_large` when the
 * download itself is oversized, `entry_null_byte`, `entry_absolute_path`,
 * `entry_path_traversal`, or `entry_symlink` for a hostile entry, and — from
 * `stripWrappingDirectory` — `ambiguous_layout` when several directories each hold a
 * `SKILL.md`, or `skill_md_missing` when none does.
 *
 * @remarks
 * Limits are checked against the central directory's declared sizes *before* anything is
 * decompressed, so an ordinary zip bomb is refused without being expanded. Those sizes are
 * written by whoever built the archive, so the real total is re-checked afterwards to
 * catch a header that lied.
 *
 * @example
 * ```ts
 * const files = extractSkillFiles(await downloadBinary(client, `/skills/${id}/artifact`));
 * // -> [{ path: "SKILL.md", bytes: Uint8Array }, ...]
 * ```
 */
export function extractSkillFiles(zipBytes: Uint8Array): SkillFile[] {
  if (zipBytes.byteLength > ARTIFACT_MAX_TRANSFER_BYTES) {
    throw new SkillValidationError(
      "artifact_too_large",
      `An Artifact is at most ${ARTIFACT_MAX_TRANSFER_BYTES} bytes; this one is ${zipBytes.byteLength}.`,
    );
  }

  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const entries = readCentralDirectory(zipBytes, view).filter((entry) => !entry.name.endsWith("/"));

  enforceEntryCount(entries.length);
  enforceUncompressedSize(entries.reduce((total, entry) => total + entry.declaredSize, 0));

  for (const entry of entries) {
    validateEntryName(entry.name);
    if (entry.isSymlink) {
      throw new SkillValidationError("entry_symlink", `Artifact entry "${entry.name}" is a symlink.`);
    }
  }

  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(zipBytes);
  } catch {
    throw new SkillValidationError("corrupt_archive", "Not a valid zip archive.");
  }

  const files: SkillFile[] = entries.map((entry) => {
    const bytes = unzipped[entry.name];
    if (!bytes) {
      throw new SkillValidationError("corrupt_archive", `Artifact entry "${entry.name}" is missing from the archive body.`);
    }
    return { path: entry.name, bytes };
  });

  enforceUncompressedSize(files.reduce((total, file) => total + file.bytes.byteLength, 0));

  return stripWrappingDirectory(files);
}
