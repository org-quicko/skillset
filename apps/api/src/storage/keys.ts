/**
 * One object per Resource, keyed by id (ADR-0026). Deliberately not the
 * name: an MCP Server's name contains a slash, which would otherwise create
 * a nested object path, and `id` is already stable across every republish.
 * Existing objects under `skills/<name>.zip` are not migrated.
 */
export function artifactKey(resourceId: string): string {
  return `resources/${resourceId}.zip`;
}

/** An Artifact is a zip; the presigned upload is signed for exactly this type. */
export const ARTIFACT_CONTENT_TYPE = "application/zip";

/** Long enough to transfer up to the 10 MiB an Artifact may be, short enough to be no use if leaked. */
export const ARTIFACT_UPLOAD_EXPIRY_SECONDS = 900;

/** About a minute, per the spec — the redirect is followed immediately. */
export const ARTIFACT_DOWNLOAD_EXPIRY_SECONDS = 60;
