import { parse as parseYaml } from "yaml";
import {
  SkillValidationError,
  validateSkillAllowedTools,
  validateSkillCompatibility,
  validateSkillDescription,
  validateSkillLicense,
  validateSkillMetadata,
  validateSkillName,
} from "./skill-rules.js";

/**
 * A parsed `SKILL.md`. Its frontmatter is the source of truth for a Skill's
 * `name` and `description`, plus the four optional fields the Agent Skills
 * specification defines (CONTEXT.md); `body` is everything below the
 * frontmatter, which is what gets stored and rendered.
 */
export interface SkillDocument {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowed_tools?: string;
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
 * block isn't valid YAML or isn't a mapping, or one of `validateSkillName`,
 * `validateSkillDescription`, `validateSkillLicense`,
 * `validateSkillCompatibility`, `validateSkillMetadata`, or
 * `validateSkillAllowedTools`'s rules if a field fails validation.
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
  const license = validateSkillLicense(fields.license);
  const compatibility = validateSkillCompatibility(fields.compatibility);
  const metadata = validateSkillMetadata(fields.metadata);
  const allowed_tools = validateSkillAllowedTools(fields["allowed-tools"]);

  return {
    name: validateSkillName(fields.name),
    description: validateSkillDescription(fields.description),
    ...(license !== undefined ? { license } : {}),
    ...(compatibility !== undefined ? { compatibility } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    ...(allowed_tools !== undefined ? { allowed_tools } : {}),
    body: match[2] ?? "",
  };
}
