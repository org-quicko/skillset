/** What a caller may vary about a folder read. */
export interface SkillFolderOptions {
  /**
   * Sent as `Authorization: Bearer`. Omit for an anonymous read, which reaches
   * public projects only and is rate-limited far harder (ADR-0010).
   */
  token?: string;
  /** Defaults to the global `fetch`. Tests pass a fake rather than reassigning the global. */
  fetch?: typeof fetch;
  /** Defaults to `ARTIFACT_MAX_ENTRIES`. */
  maxFiles?: number;
  /** Defaults to `ARTIFACT_MAX_UNCOMPRESSED_BYTES`. */
  maxBytes?: number;
  /**
   * For discovery: the files, relative to a folder, that mark it as a
   * Resource. Defaults to `SKILL.md`; a Plugin passes its agent manifests
   * (`PLUGIN_MANIFEST_PATHS`).
   */
  markers?: readonly string[];
}
