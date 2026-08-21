/**
 * One object per Skill, keyed by name. The key is derived rather than stored
 * (docs/data-model.md) — the name is the Skill's identity, so there is
 * nothing else for a key to be.
 */
export function artifactKey(skillName: string): string {
  return `skills/${skillName}.zip`;
}

/** An Artifact is a zip; the presigned upload is signed for exactly this type. */
export const ARTIFACT_CONTENT_TYPE = "application/zip";

/** Long enough to transfer up to the 10 MiB an Artifact may be, short enough to be no use if leaked. */
export const ARTIFACT_UPLOAD_EXPIRY_SECONDS = 900;

/** About a minute, per the spec — the redirect is followed immediately. */
export const ARTIFACT_DOWNLOAD_EXPIRY_SECONDS = 60;
