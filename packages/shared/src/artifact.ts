import { zipSync } from "fflate";
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
 * An Artifact archives the Skill's *contents* at its root. A single
 * wrapping directory — what you get from zipping the folder rather than what
 * is in it — is tolerated and stripped. A layout with several candidate
 * Skills in it is rejected rather than guessed at.
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
 * Zips the given files at the archive's root. Limits are checked before
 * compressing where they can be — an over-limit set of files is refused
 * without spending the work — and the transfer limit afterwards, since it is
 * a property of the compressed bytes.
 */
export function buildArtifact(files: SkillFile[]): Uint8Array {
  if (files.length > ARTIFACT_MAX_ENTRIES) {
    throw new SkillValidationError(
      "too_many_entries",
      `A Skill holds at most ${ARTIFACT_MAX_ENTRIES} files; this one has ${files.length}.`,
    );
  }

  const uncompressed = files.reduce((total, file) => total + file.bytes.byteLength, 0);
  if (uncompressed > ARTIFACT_MAX_UNCOMPRESSED_BYTES) {
    throw new SkillValidationError(
      "uncompressed_too_large",
      `A Skill's files come to at most ${ARTIFACT_MAX_UNCOMPRESSED_BYTES} bytes uncompressed; these come to ${uncompressed}.`,
    );
  }

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
