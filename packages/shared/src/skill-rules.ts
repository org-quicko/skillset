/**
 * The Skill validation rules, in one place. Every surface applies these same
 * functions — the CLI and the web interface before they upload anything, and
 * the API on the metadata it is posted — so a Skill rejected locally is
 * rejected for the same stated reason server-side (spec, "Publishing").
 *
 * A failure carries a `rule` and, where there is one, the `field` or file
 * that broke it. Those two land verbatim in the API's error body as `code`
 * and `field`, which is how a caller reports the specific rule rather than
 * "invalid request".
 */

export const SKILL_NAME_MAX_LENGTH = 64;
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;

/** Lowercase alphanumerics and hyphens; no leading, trailing, or doubled hyphen. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The mandatory file at the root of a Skill. */
export const SKILL_FILE_NAME = "SKILL.md";

export type SkillRule =
  | "name_required"
  | "name_too_long"
  | "name_invalid"
  | "description_required"
  | "description_too_long"
  | "body_required"
  | "frontmatter_missing"
  | "frontmatter_invalid"
  | "skill_md_missing"
  | "ambiguous_layout"
  | "too_many_entries"
  | "artifact_too_large"
  | "uncompressed_too_large";

export class SkillValidationError extends Error {
  // Declared and assigned rather than written as parameter properties: the
  // web interface compiles shared code with erasableSyntaxOnly.
  readonly rule: SkillRule;
  readonly field: string | undefined;

  constructor(rule: SkillRule, message: string, field?: string) {
    super(message);
    this.name = "SkillValidationError";
    this.rule = rule;
    this.field = field;
  }
}

export function validateSkillName(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new SkillValidationError("name_required", "A Skill needs a name in its SKILL.md frontmatter.", "name");
  }
  if (value.length > SKILL_NAME_MAX_LENGTH) {
    throw new SkillValidationError(
      "name_too_long",
      `A Skill's name is at most ${SKILL_NAME_MAX_LENGTH} characters.`,
      "name",
    );
  }
  if (!SKILL_NAME_PATTERN.test(value)) {
    throw new SkillValidationError(
      "name_invalid",
      "A Skill's name is lowercase alphanumerics and hyphens, with no leading, trailing, or doubled hyphen.",
      "name",
    );
  }
  return value;
}

export function validateSkillDescription(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SkillValidationError(
      "description_required",
      "A Skill needs a description in its SKILL.md frontmatter.",
      "description",
    );
  }
  if (value.length > SKILL_DESCRIPTION_MAX_LENGTH) {
    throw new SkillValidationError(
      "description_too_long",
      `A Skill's description is at most ${SKILL_DESCRIPTION_MAX_LENGTH} characters.`,
      "description",
    );
  }
  return value;
}

export function validateSkillBody(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SkillValidationError("body_required", "A Skill needs a SKILL.md body.", "body");
  }
  return value;
}
