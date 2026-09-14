import { unzipSync } from "fflate";
import {
  ARTIFACT_MAX_TRANSFER_BYTES,
  stripWrappingDirectory,
  validateArtifactPath,
  validateArtifactSize,
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
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_LENGTH = 30;
/** General-purpose bit 3: sizes are in a trailing data descriptor, and the local header's read zero (APPNOTE 4.4.4). */
const DATA_DESCRIPTOR_FLAG = 0x0008;

interface CentralDirectoryEntry {
  name: string;
  /** The size the archive *claims* it will expand to. Declared by the archive's author, so it bounds the work but does not prove it. */
  declaredSize: number;
  /** Where this entry's local file header sits, so its own declared size can be held against the one above. */
  localHeaderOffset: number;
  /** Set when the entry's sizes live in a trailing data descriptor rather than its local header, which then reads zero. */
  hasDataDescriptor: boolean;
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
    const generalPurposeFlag = view.getUint16(offset + 8, true);
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
      localHeaderOffset: view.getUint32(offset + 42, true),
      hasDataDescriptor: (generalPurposeFlag & DATA_DESCRIPTOR_FLAG) !== 0,
      isSymlink: hostOs === UNIX_HOST_OS && ((externalAttrs >>> 16) & S_IFMT) === S_IFLNK,
    });

    offset += CENTRAL_DIR_HEADER_LENGTH + nameLength + extraLength + commentLength;
  }

  return entries;
}

/**
 * Holds an entry's two declarations of its own size against each other.
 *
 * @remarks
 * `unzipSync` sizes each output buffer from the central directory, so an entry whose
 * central declaration understates its real content comes back *truncated to that
 * declaration* rather than overrunning the limit enforced from the same numbers. Memory is
 * bounded by that either way — but it means the size check alone cannot tell an honest
 * archive from a rewritten one, and a short read would install as if it were the file.
 *
 * The local header carries the same size a second time. Rewriting one and not the other is
 * what a header edited to slip past the limit looks like, and that disagreement is the only
 * trace the truncation leaves.
 */
function enforceDeclaredSizesAgree(bytes: Uint8Array, view: DataView, entry: CentralDirectoryEntry): void {
  // Bit 3 puts the real sizes in a trailing descriptor and leaves the local header's at
  // zero, so there is nothing here to compare against.
  if (entry.hasDataDescriptor) return;

  const offset = entry.localHeaderOffset;
  if (offset + LOCAL_HEADER_LENGTH > bytes.length || view.getUint32(offset, true) !== LOCAL_HEADER_SIGNATURE) {
    throw new SkillValidationError("corrupt_archive", "Not a valid zip archive.");
  }

  const localSize = view.getUint32(offset + 22, true);
  if (localSize !== entry.declaredSize) {
    throw new SkillValidationError(
      "corrupt_archive",
      `Artifact entry "${entry.name}" declares ${entry.declaredSize} bytes in the central directory and ${localSize} in its own header.`,
    );
  }
}

/**
 * Unpacks a downloaded Artifact into the files that will be written to disk.
 *
 * This is the only place an incoming Artifact is inspected (ADR-0001 — the API never
 * does), so it is where a hostile one is stopped: it refuses path traversal, absolute
 * paths, drive letters, backslashes, null bytes, and symlink entries, enforces the same
 * transfer, entry-count and uncompressed-size limits publishing does, and tolerates or
 * rejects a wrapping directory exactly the way `buildSkillBundle` does.
 *
 * @param zipBytes - The Artifact as downloaded from storage.
 * @returns The Skill's files, with any single wrapping directory stripped from their paths.
 * @throws SkillValidationError with rule `corrupt_archive` when the bytes are not a
 * readable zip or an entry does not hold the bytes it declares, `unsupported_archive` for
 * zip64, `too_many_entries` or `uncompressed_too_large` when a limit is exceeded,
 * `artifact_too_large` when the download itself is oversized, `entry_null_byte`,
 * `entry_absolute_path`, `entry_backslash`, `entry_path_traversal`, `entry_not_a_file`,
 * or `entry_symlink` for a hostile entry, and — from `stripWrappingDirectory` — `ambiguous_layout` when
 * several directories each hold a `SKILL.md`, or `skill_md_missing` when none does.
 *
 * @remarks
 * Limits are checked against the central directory's declared sizes *before* anything is
 * decompressed, and `unzipSync` sizes each output buffer from those same numbers, so the
 * memory an archive can claim is bounded by the total this refuses. A header that
 * understates its entry cannot overrun that limit — it truncates to it instead, which is
 * what `enforceDeclaredSizesAgree` is for.
 *
 * What this does not bound is the *time* spent inflating: the bytes past the declared
 * length are still decompressed before being discarded, so a highly compressible Artifact
 * within the transfer limit can burn CPU before it is refused. That is a local cost in
 * the CLI, on an Artifact the User asked for, and bounding it would mean inflating every
 * entry by hand rather than through `unzipSync`.
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

  validateArtifactSize(entries, (entry) => entry.declaredSize);

  for (const entry of entries) {
    validateArtifactPath(entry.name);
    if (entry.isSymlink) {
      throw new SkillValidationError("entry_symlink", `Artifact entry "${entry.name}" is a symlink.`);
    }
    enforceDeclaredSizesAgree(zipBytes, view, entry);
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

  return stripWrappingDirectory(files);
}
