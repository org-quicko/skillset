import { buildArtifact, collectSkillFiles, type SkillFile } from "./artifact.js";
import { parseSkillDocument, type SkillDocument } from "./frontmatter.js";
import { SKILL_FILE_NAME, SkillValidationError } from "./skill-rules.js";

/** A Skill's validated metadata alongside the Artifact that holds its files. */
export interface SkillBundle extends SkillDocument {
  artifact: Uint8Array;
}

/**
 * The whole publishing pipeline, shared by the CLI and the web interface
 * (spec, "Publishing"): a set of files in, validated metadata and an
 * Artifact out. Nothing here reads or writes anything — the caller supplies
 * the bytes and sends the result.
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

  const document = parseSkillDocument(new TextDecoder().decode(skillMd.bytes));
  return { ...document, artifact: buildArtifact(collected) };
}
