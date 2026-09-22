import { collectSkillFiles, validateArtifactSize, type SkillFile } from "./artifact.js";
import { parseSkillDocument } from "./frontmatter.js";
import type { SkillPublish } from "./skill.js";
import { SKILL_FILE_NAME, SkillValidationError } from "./skill-rules.js";

/**
 * Everything publishing a Skill takes, and nothing else: the path segment, the
 * request body, and the files.
 *
 * @remarks
 * The frontmatter fields are deliberately *not* also spread across this object.
 * They were, and both publishers copied them out one at a time into a
 * hand-written body — the same six keys in two apps, with nothing linking them
 * and nothing failing if a seventh field reached only one. `request` is that
 * body, built once, so there is no longer a second way to spell it.
 */
export interface SkillBundle {
  /** The Skill's name, from its frontmatter — the `PUT /resources/skill/{name}` path segment. */
  name: string;
  /** The `PUT /resources/skill/{name}` request body, exactly as the wire takes it. */
  request: SkillPublish;
  /**
   * The Skill's files, each uploaded straight to its own presigned
   * destination rather than through the API (ADR-0001, ADR-0032). In the same
   * order as `request.files`, so a caller can pair each one with the upload
   * target the publish response returned for it.
   */
  files: SkillFile[];
}

/** What {@link buildSkillBundle} takes beyond the files themselves. */
export interface BuildSkillBundleOptions {
  /**
   * Where these files came from, when that is somewhere other than the caller's
   * own disk — a repository URL for an Import. Omitted, the Registry records
   * itself as the source (ADR-0041).
   */
  source?: string;
}

/**
 * Turns a set of files into everything needed to publish them as a Skill.
 *
 * @remarks
 * The whole publishing pipeline, shared by the CLI and the web interface
 * (spec, "Publishing"): a set of files in, a validated request and the files
 * to upload out. Nothing here reads or writes anything — the caller supplies
 * the bytes and sends the result.
 *
 * The request body is the parsed `SKILL.md` document minus its `name`, plus
 * the Artifact's manifest. The name identifies the Skill in the path, so
 * repeating it in the body would give one value two homes; the manifest is in
 * the body because the presigned destinations the API returns are derived
 * from it (ADR-0032).
 *
 * A field the frontmatter never set is absent from `request` rather than
 * present and `undefined`, so a publisher sends only what was actually
 * written.
 *
 * @param files - The Skill's files, at paths relative to its root. Excluded
 * paths are dropped and a single wrapping directory is stripped before
 * anything is read.
 * @param options - `source`, when the files came from somewhere nameable. It
 * is not read out of the files: only the caller knows whether they were
 * fetched from a repository or picked off a disk.
 * @returns The Skill's name, its publish request body, and the files to
 * upload.
 * @throws SkillValidationError with rule `skill_md_missing` if no `SKILL.md`
 * is at the root, `ambiguous_layout` if several directories hold one, one of
 * `parseSkillDocument`'s rules if the frontmatter is missing, unparseable, or
 * fails a field rule, or `too_many_entries`/`uncompressed_too_large` if the
 * files exceed what an Artifact may hold.
 * @example
 * ```ts
 * const bundle = buildSkillBundle(files);
 * const published = await fetch(`/api/resources/skill/${encodeURIComponent(bundle.name)}`, {
 *   method: "PUT",
 *   body: JSON.stringify(bundle.request),
 * }).then((res) => res.json());
 * // then PUT each of bundle.files to the matching published.upload.files entry
 * ```
 */
export function buildSkillBundle(files: SkillFile[], options: BuildSkillBundleOptions = {}): SkillBundle {
  const collected = collectSkillFiles(files);
  validateArtifactSize(collected, (file) => file.bytes.byteLength);

  const skillMd = collected.find((file) => file.path === SKILL_FILE_NAME);
  if (!skillMd) {
    throw new SkillValidationError(
      "skill_md_missing",
      `A Skill needs a ${SKILL_FILE_NAME} at its root.`,
      SKILL_FILE_NAME,
    );
  }

  // `SkillPublish` is precisely a SkillDocument without its name, plus the
  // manifest, so the rest of the destructure *is* the request body — no field
  // list to keep in step.
  const { name, ...document } = parseSkillDocument(new TextDecoder().decode(skillMd.bytes));
  const manifest = collected.map((file) => ({ path: file.path, size: file.bytes.byteLength }));

  return {
    name,
    request: { ...document, ...(options.source ? { source: options.source } : {}), files: manifest },
    files: collected,
  };
}
