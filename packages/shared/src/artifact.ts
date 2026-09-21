import { zipSync } from "fflate";
import type { ArtifactFile } from "./skill.js";
import { SKILL_FILE_NAME, SkillValidationError } from "./skill-rules.js";

/** Structural limits on an Artifact (spec, "Publishing"). */
export const ARTIFACT_MAX_TRANSFER_BYTES = 10 * 1024 * 1024;
export const ARTIFACT_MAX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
export const ARTIFACT_MAX_ENTRIES = 1000;

/** One file of a Skill, at a path relative to the Skill's root. */
export interface SkillFile {
  path: string;
  bytes: Uint8Array;
}

/**
 * Directories that are never part of a Skill: dependency directories by
 * name, and anything dot-prefixed — which covers version-control metadata
 * (`.git`), tooling directories, and dotfile editor artifacts (`.DS_Store`)
 * in one rule. They are dropped before anything is counted, so a writer is
 * never told they breached the entry limit with files they did not know they
 * were sending.
 */
const EXCLUDED_DIRECTORY_NAMES = new Set(["node_modules", "__pycache__"]);
const EXCLUDED_FILE_NAMES = new Set(["Thumbs.db", "desktop.ini"]);
const EXCLUDED_FILE_SUFFIXES = ["~", ".swp", ".swo"];

/** Normalises to forward slashes and drops a leading `./`, so path rules see one form. */
export function normalizeSkillPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Whether a file path should be dropped before a Skill's files are counted
 * or archived.
 *
 * @remarks
 * Excludes dependency directories by name, anything dot-prefixed (version
 * control metadata, tooling directories, dotfile editor artifacts), known
 * OS/editor cruft file names, and editor backup file suffixes.
 *
 * @param path - The file's path, relative to the Skill's root.
 * @returns `true` if the path should be excluded.
 */
export function isExcludedPath(path: string): boolean {
  const segments = normalizeSkillPath(path).split("/");
  const fileName = segments[segments.length - 1] ?? "";

  if (segments.some((segment) => segment.startsWith("."))) return true;
  if (segments.slice(0, -1).some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment))) return true;
  if (EXCLUDED_DIRECTORY_NAMES.has(fileName)) return true;
  if (EXCLUDED_FILE_NAMES.has(fileName)) return true;
  return EXCLUDED_FILE_SUFFIXES.some((suffix) => fileName.endsWith(suffix));
}

/**
 * Refuses a path that would escape the directory it is written into, or the
 * object-storage prefix it is stored under.
 *
 * @remarks
 * Applied at two edges, which is why it lives here rather than in the zip
 * reader it started in: `skillset install` checks every entry of a downloaded
 * Artifact before writing it to a developer's filesystem, and the API checks
 * every path a publisher declares before turning it into a storage key
 * (ADR-0032). The same rules describe both dangers — a path that is safe as
 * a storage key suffix is safe as a filesystem path, and the reverse.
 *
 * A path separates with `/` and nothing else (PKZIP APPNOTE 4.4.17.1), so a
 * backslash is never a legitimate separator. It has to be refused before the
 * traversal check rather than folded into it: on Windows `path.join` treats
 * a backslash as a separator, so a name like `a\..\..\evil.md` walks out of
 * the install directory while carrying no `..` segment and no leading `/`
 * for either of those to catch. The same goes for a UNC name, which is
 * absolute without starting with `/` or a drive letter.
 *
 * @param path - The candidate path, relative to the Skill's root.
 * @throws SkillValidationError with rule `entry_null_byte`,
 * `entry_backslash`, `entry_absolute_path`, `entry_path_traversal`, or
 * `entry_not_a_file`, naming the path in both the message and the `field`.
 * @example
 * ```ts
 * validateArtifactPath("references/java.md"); // ok
 * validateArtifactPath("../etc/passwd"); // throws entry_path_traversal
 * ```
 */
export function validateArtifactPath(path: string): void {
  if (path.includes("\0")) {
    throw new SkillValidationError("entry_null_byte", `Artifact entry "${path}" contains a null byte.`, path);
  }
  if (path.includes("\\")) {
    throw new SkillValidationError("entry_backslash", `Artifact entry "${path}" contains a backslash.`, path);
  }
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new SkillValidationError("entry_absolute_path", `Artifact entry "${path}" is an absolute path.`, path);
  }
  if (path.split("/").includes("..")) {
    throw new SkillValidationError("entry_path_traversal", `Artifact entry "${path}" has a parent-directory segment.`, path);
  }
  // A trailing slash names a directory, and an empty segment anywhere would
  // collapse into one on the way to a storage key — neither is a file, and a
  // manifest declares files.
  if (path.length === 0 || path.split("/").some((segment) => segment.length === 0)) {
    throw new SkillValidationError("entry_not_a_file", `Artifact entry "${path}" does not name a file.`, path);
  }
}

/**
 * Enforces the count and total-size limits on a set of Artifact files.
 *
 * @remarks
 * Both limits are properties of the files themselves rather than of any
 * archive built from them, so they apply identically to a client about to
 * upload, to the API validating a declared manifest, and to `skillset install`
 * unpacking a download. `sizeOf` is what lets the API apply them to a
 * manifest of `(path, size)` pairs it has no bytes for.
 *
 * @param files - The files to check.
 * @param sizeOf - Each file's byte length.
 * @throws SkillValidationError with rule `too_many_entries` if there are
 * more than `ARTIFACT_MAX_ENTRIES`, or `uncompressed_too_large` if they come
 * to more than `ARTIFACT_MAX_UNCOMPRESSED_BYTES` in total.
 * @example
 * ```ts
 * validateArtifactSize(manifest, (file) => file.size);
 * ```
 */
export function validateArtifactSize<T>(files: readonly T[], sizeOf: (file: T) => number): void {
  if (files.length > ARTIFACT_MAX_ENTRIES) {
    throw new SkillValidationError(
      "too_many_entries",
      `A Skill holds at most ${ARTIFACT_MAX_ENTRIES} files; this one has ${files.length}.`,
    );
  }

  const uncompressed = files.reduce((total, file) => total + sizeOf(file), 0);
  if (uncompressed > ARTIFACT_MAX_UNCOMPRESSED_BYTES) {
    throw new SkillValidationError(
      "uncompressed_too_large",
      `A Skill's files come to at most ${ARTIFACT_MAX_UNCOMPRESSED_BYTES} bytes uncompressed; these come to ${uncompressed}.`,
    );
  }
}

/**
 * Validates an Artifact's declared manifest — the paths and sizes a
 * publisher says it is about to upload.
 *
 * @remarks
 * The API's whole view of an Artifact's shape (ADR-0032). It never reads the
 * bytes (ADR-0001), so this is the only point at which a hostile or
 * malformed layout can be refused *before* a presigned destination is handed
 * out for it: every path is held to `validateArtifactPath`, since each one
 * becomes a storage key, and the same count and size limits publishing
 * enforces locally are enforced here on the declared numbers.
 *
 * A declared size is the publisher's own claim, so the total this bounds is
 * a claim too. What it buys is that the API cannot be talked into signing an
 * upload for a thousand-and-first file, or for a key outside the Resource's
 * own prefix — not that the bytes which arrive match what was declared.
 * Nothing detects that drift, exactly as ADR-0001 says of `description` and
 * `body`.
 *
 * @param value - The candidate manifest, straight off the wire and not yet
 * known to be an array of anything.
 * @returns The manifest, typed and with its paths normalised.
 * @throws SkillValidationError with rule `manifest_invalid` if `value` is not
 * an array of `(path, size)` pairs, `entry_duplicate` if two entries name the
 * same path, `skill_md_missing` if no entry is the root `SKILL.md`, one of
 * `validateArtifactPath`'s rules for a path that would escape the Resource's
 * prefix, or `too_many_entries`/`uncompressed_too_large` if the declared
 * files exceed what an Artifact may hold.
 * @example
 * ```ts
 * const manifest = validateArtifactManifest(payload.files);
 * // -> [{ path: "SKILL.md", size: 812 }, { path: "references/java.md", size: 4096 }]
 * ```
 */
export function validateArtifactManifest(value: unknown): ArtifactFile[] {
  if (!Array.isArray(value)) {
    throw new SkillValidationError("manifest_invalid", "A Skill's files must be given as a list.", "files");
  }

  const manifest: ArtifactFile[] = value.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new SkillValidationError("manifest_invalid", "Each of a Skill's files must be a path and a size.", "files");
    }
    const { path, size } = entry as { path?: unknown; size?: unknown };
    if (typeof path !== "string") {
      throw new SkillValidationError("manifest_invalid", "Each of a Skill's files needs a path.", "files");
    }
    if (typeof size !== "number" || !Number.isInteger(size) || size < 0) {
      throw new SkillValidationError(
        "manifest_invalid",
        `A Skill's file needs a size in whole, non-negative bytes; "${path}" declares ${String(size)}.`,
        path,
      );
    }
    const normalized = normalizeSkillPath(path);
    validateArtifactPath(normalized);
    return { path: normalized, size };
  });

  const seen = new Set<string>();
  for (const file of manifest) {
    if (seen.has(file.path)) {
      throw new SkillValidationError("entry_duplicate", `A Skill lists "${file.path}" more than once.`, file.path);
    }
    seen.add(file.path);
  }

  if (!seen.has(SKILL_FILE_NAME)) {
    throw new SkillValidationError(
      "skill_md_missing",
      `A Skill needs a ${SKILL_FILE_NAME} at its root.`,
      SKILL_FILE_NAME,
    );
  }

  validateArtifactSize(manifest, (file) => file.size);
  return manifest;
}

/**
 * An Artifact holds the Skill's *contents* at its root. A single wrapping
 * directory — what you get from zipping the folder rather than what is in
 * it — is tolerated and stripped. A layout with several candidate Skills in
 * it is rejected rather than guessed at.
 */
export function stripWrappingDirectory(files: SkillFile[]): SkillFile[] {
  if (files.some((file) => file.path === SKILL_FILE_NAME)) return files;

  const topSegments = new Set(files.map((file) => file.path.split("/")[0] ?? ""));
  const [wrapper] = [...topSegments];

  if (topSegments.size === 1 && wrapper !== undefined) {
    const stripped = files
      .filter((file) => file.path.startsWith(`${wrapper}/`))
      .map((file) => ({ ...file, path: file.path.slice(wrapper.length + 1) }));
    if (stripped.some((file) => file.path === SKILL_FILE_NAME)) return stripped;
  }

  const candidates = [...topSegments].filter((segment) =>
    files.some((file) => file.path === `${segment}/${SKILL_FILE_NAME}`),
  );
  if (candidates.length > 1) {
    throw new SkillValidationError(
      "ambiguous_layout",
      `Several directories hold a ${SKILL_FILE_NAME} (${candidates.join(", ")}) — publish one Skill at a time.`,
    );
  }

  throw new SkillValidationError(
    "skill_md_missing",
    `A Skill needs a ${SKILL_FILE_NAME} at its root.`,
    SKILL_FILE_NAME,
  );
}

/** The Skill's files, normalised, filtered, and unwrapped — the exact set an Artifact holds. */
export function collectSkillFiles(files: SkillFile[]): SkillFile[] {
  const kept = files
    .map((file) => ({ ...file, path: normalizeSkillPath(file.path) }))
    .filter((file) => !isExcludedPath(file.path));

  if (kept.length === 0) {
    throw new SkillValidationError(
      "skill_md_missing",
      `A Skill needs a ${SKILL_FILE_NAME} at its root.`,
      SKILL_FILE_NAME,
    );
  }

  return stripWrappingDirectory(kept);
}

/**
 * Zips the given files at the archive's root.
 *
 * @remarks
 * An Artifact is *stored* as its files, one object each (ADR-0032); a zip is
 * a representation the API assembles on demand for the consumers that want
 * one — `skillset install`, the web Download control, and a marketplace
 * `archive` source. Limits are checked before compressing, so an over-limit
 * set of files is refused without spending the work, and the transfer limit
 * afterwards, since it is a property of the compressed bytes.
 *
 * @param files - The Skill's files, at paths relative to its root.
 * @returns The zip archive's bytes.
 * @throws SkillValidationError with rule `too_many_entries` or
 * `uncompressed_too_large` if the files exceed what an Artifact may hold, or
 * `artifact_too_large` if the archive they compress to does.
 * @example
 * ```ts
 * const zip = buildArtifact([{ path: "SKILL.md", bytes }]);
 * ```
 */
export function buildArtifact(files: SkillFile[]): Uint8Array {
  validateArtifactSize(files, (file) => file.bytes.byteLength);

  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[file.path] = file.bytes;
  }
  const artifact = zipSync(entries);

  if (artifact.byteLength > ARTIFACT_MAX_TRANSFER_BYTES) {
    throw new SkillValidationError(
      "artifact_too_large",
      `An Artifact is at most ${ARTIFACT_MAX_TRANSFER_BYTES} bytes; this one is ${artifact.byteLength}.`,
    );
  }

  return artifact;
}
