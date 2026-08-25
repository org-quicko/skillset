import { parse as parseYaml } from "yaml";
import {
  SkillValidationError,
  validateSkillDescription,
  validateSkillName,
} from "./skill-rules.js";

/**
 * A parsed `SKILL.md`. Its frontmatter is the sole source of truth for a
 * Skill's name and description (CONTEXT.md); `body` is everything below the
 * frontmatter, which is what gets stored and rendered.
 */
export interface SkillDocument {
  name: string;
  description: string;
  body: string;
}

// Opening fence on the first line, closing fence on its own line. A file
// without one has no frontmatter at all, which is a different failure from
// frontmatter that does not parse.
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

/**
 * Parses a SKILL.md's YAML frontmatter and body.
 *
 * @param source - The raw contents of a SKILL.md file.
 * @returns `SkillDocument`
 * @throws SkillValidationError with rule `frontmatter_missing` if the file
 * has no `---`-fenced frontmatter, `frontmatter_invalid` if the fenced
 * block isn't valid YAML or isn't a mapping, or one of
 * `validateSkillName`'s or `validateSkillDescription`'s rules if a field
 * fails validation.
 */
export function parseSkillDocument(source: string): SkillDocument {
  const match = FRONTMATTER_PATTERN.exec(source.replace(/^\uFEFF/, ""));
  if (!match) {
    throw new SkillValidationError(
      "frontmatter_missing",
      "SKILL.md must open with YAML frontmatter fenced by ---.",
      "SKILL.md",
    );
  }

  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(match[1] ?? "");
  } catch (error) {
    throw new SkillValidationError(
      "frontmatter_invalid",
      `SKILL.md frontmatter is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
      "SKILL.md",
    );
  }

  if (frontmatter === null || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    throw new SkillValidationError(
      "frontmatter_invalid",
      "SKILL.md frontmatter must be a mapping of keys to values.",
      "SKILL.md",
    );
  }

  const fields = frontmatter as Record<string, unknown>;
  return {
    name: validateSkillName(fields.name),
    description: validateSkillDescription(fields.description),
    body: match[2] ?? "",
  };
}
