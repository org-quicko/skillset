/**
 * One object per file of a Resource's Artifact, under a prefix keyed by the
 * Resource's `id` (ADR-0026, ADR-0032). Deliberately not the name: an MCP
 * Server's name contains a slash, which would blur the boundary between the
 * Resource's prefix and the paths inside it, and `id` is already stable
 * across every republish.
 *
 * The trailing slash is part of the prefix, so listing it cannot also match a
 * sibling whose id merely starts with these characters.
 */
export function artifactPrefix(resourceId: string): string {
  return `resources/${resourceId}/`;
}

/**
 * The storage key one file of a Resource's Artifact lives at.
 *
 * @remarks
 * `path` must already have been through `validateArtifactPath`
 * (`@skillset/shared`) — this only concatenates, so a path with a `..`
 * segment or a leading slash would address an object outside the Resource's
 * prefix. The API validates every declared path at publish time and every
 * requested path on read, which is what makes concatenation safe here
 * (ADR-0032).
 *
 * @param resourceId - The Resource's id.
 * @param path - The file's path, relative to the Skill's root.
 * @returns The object's full storage key.
 * @example
 * ```ts
 * artifactFileKey(id, "references/java.md"); // "resources/<id>/references/java.md"
 * ```
 */
export function artifactFileKey(resourceId: string, path: string): string {
  return `${artifactPrefix(resourceId)}${path}`;
}

/**
 * The path within an Artifact that a storage key names, or `null` if the key
 * does not sit under that Resource's prefix.
 *
 * @param resourceId - The Resource's id.
 * @param key - A storage key, typically straight from a prefix listing.
 * @returns The path relative to the Skill's root, or `null`.
 */
export function artifactPathFromKey(resourceId: string, key: string): string | null {
  const prefix = artifactPrefix(resourceId);
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

/**
 * The `content-type` every Artifact file is uploaded with.
 *
 * A presigned PUT is signed for one exact content type, so signing each file
 * for a type guessed from its extension would make a publisher's upload fail
 * on any disagreement — and the API has no bytes to check the guess against
 * (ADR-0001). It stores them opaquely instead and labels them properly on
 * the way out, where `artifactMediaType` (`@skillset/shared`) answers
 * from the path.
 */
export const ARTIFACT_UPLOAD_CONTENT_TYPE = "application/octet-stream";

/** An assembled Artifact is a zip; that is what the download endpoint serves. */
export const ARTIFACT_ARCHIVE_CONTENT_TYPE = "application/zip";

/** Long enough to transfer up to the 10 MiB an Artifact may be, short enough to be no use if leaked. */
export const ARTIFACT_UPLOAD_EXPIRY_SECONDS = 900;
