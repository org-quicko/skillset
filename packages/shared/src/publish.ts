import { buildArtifact, collectSkillFiles, type SkillFile } from "./artifact.js";
import { parseSkillDocument } from "./frontmatter.js";
import type { SkillPublish } from "./skill.js";
import { SKILL_FILE_NAME, SkillValidationError } from "./skill-rules.js";

/**
 * Everything publishing a Skill takes, and nothing else: the path segment, the
 * request body, and the bytes.
 *
 * @remarks
 * The frontmatter fields are deliberately *not* also spread across this object.
 * They were, and both publishers copied them out one at a time into a
 * hand-written body — the same six keys in two apps, with nothing linking them
 * and nothing failing if a seventh field reached only one. `request` is that
 * body, built once, so there is no longer a second way to spell it.
 */
export interface SkillBundle {
  /** The Skill's name, from its frontmatter — the `PUT /skills/{name}` path segment. */
  name: string;
  /** The `PUT /skills/{name}` request body, exactly as the wire takes it. */
  request: SkillPublish;
  /** The zipped Skill, uploaded straight to storage rather than through the API (ADR-0001). */
  artifact: Uint8Array;
}

/**
 * Turns a set of files into everything needed to publish them as a Skill.
 *
 * @remarks
 * The whole publishing pipeline, shared by the CLI and the web interface
 * (spec, "Publishing"): a set of files in, a validated request and an Artifact
 * out. Nothing here reads or writes anything — the caller supplies the bytes
 * and sends the result.
 *
 * The request body is the parsed `SKILL.md` document minus its `name`, which
 * is what `SkillPublish` describes: the name identifies the Skill in the path,
 * so repeating it in the body would give one value two homes.
 *
 * A field the frontmatter never set is absent from `request` rather than
 * present and `undefined`, so a publisher sends only what was actually
 * written.
 *
 * @param files - The Skill's files, at paths relative to its root. Excluded
 * paths are dropped and a single wrapping directory is stripped before
 * anything is read.
 * @returns The Skill's name, its publish request body, and its Artifact.
 * @throws SkillValidationError with rule `skill_md_missing` if no `SKILL.md`
 * is at the root, `ambiguous_layout` if several directories hold one, one of
 * `parseSkillDocument`'s rules if the frontmatter is missing, unparseable, or
 * fails a field rule, or one of `buildArtifact`'s if the files exceed what an
 * Artifact may hold.
 * @example
 * ```ts
 * const bundle = buildSkillBundle(files);
 * await fetch(`/api/skills/${encodeURIComponent(bundle.name)}`, {
 *   method: "PUT",
 *   body: JSON.stringify(bundle.request),
 * });
 * ```
 */
export function buildSkillBundle(files: SkillFile[]): SkillBundle {
  const collected = collectSkillFiles(files);

  const skillMd = collected.find((file) => file.path === SKILL_FILE_NAME);
  if (!skillMd) {
    throw new SkillValidationError(
      "skill_md_missing",
      `A Skill needs a ${SKILL_FILE_NAME} at its root.`,
      SKILL_FILE_NAME,
    );
  }

  // `SkillPublish` is precisely a SkillDocument without its name, so the rest
  // of the destructure *is* the request body — no field list to keep in step.
  const { name, ...request } = parseSkillDocument(new TextDecoder().decode(skillMd.bytes));
  return { name, request, artifact: buildArtifact(collected) };
}
