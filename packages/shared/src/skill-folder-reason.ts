/**
 * Why a folder could not be read.
 *
 * @remarks
 * `too_many_entries` and `uncompressed_too_large` deliberately reuse the
 * spellings `SkillRule` already gives the same two limits — the ceilings are
 * the ones `buildArtifact` and `extractSkillFiles` enforce, and one concept
 * should not pick up a second name on the way through the walk.
 *
 * Callers map these to their own wording: the API's sentences address a
 * connected writer acting on their own grant, the browser's a reader with no
 * credential at all, and those are not interchangeable.
 */
export type SkillFolderReason =
  | "not_found"
  | "unauthorized"
  | "rate_limited"
  | "request_failed"
  | "untrusted_download_host"
  | "empty_folder"
  | "too_many_entries"
  | "uncompressed_too_large";
