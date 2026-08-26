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

/** A `compatibility` field's maximum length, per the Agent Skills specification. */
export const SKILL_COMPATIBILITY_MAX_LENGTH = 500;

export type SkillRule =
  | "name_required"
  | "name_too_long"
  | "name_invalid"
  | "description_required"
  | "description_too_long"
  | "body_required"
  | "license_invalid"
  | "compatibility_invalid"
  | "compatibility_too_long"
  | "metadata_invalid"
  | "allowed_tools_invalid"
  | "frontmatter_missing"
  | "frontmatter_invalid"
  | "skill_md_missing"
  | "ambiguous_layout"
  | "too_many_entries"
  | "artifact_too_large"
  | "uncompressed_too_large"
  | "corrupt_archive"
  | "unsupported_archive"
  | "entry_path_traversal"
  | "entry_absolute_path"
  | "entry_null_byte"
  | "entry_symlink";

/**
 * Thrown when a Skill fails one of the shared validation rules. Carries the
 * specific `rule` that was broken and, where there is one, the `field` or
 * file — both of which land verbatim in the API's error body.
 */
export class SkillValidationError extends Error {
  // Declared and assigned rather than written as parameter properties: the
  // web interface compiles shared code with erasableSyntaxOnly.
  readonly rule: SkillRule;
  readonly field: string | undefined;

  /**
   * @param rule - The specific rule that was broken.
   * @param message - A human-readable description of the failure.
   * @param field - The request field or file the failure relates to, if any.
   */
  constructor(rule: SkillRule, message: string, field?: string) {
    super(message);
    this.name = "SkillValidationError";
    this.rule = rule;
    this.field = field;
  }
}

/**
 * Validates a Skill's name against the required shape.
 *
 * @param value - The candidate name, typically read straight from
 * frontmatter and not yet known to be a string.
 * @returns `string`
 * @throws SkillValidationError with rule `name_required` if `value` is
 * missing or not a string, `name_too_long` if it exceeds
 * `SKILL_NAME_MAX_LENGTH` characters, or `name_invalid` if it doesn't
 * match the required pattern.
 */
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

/**
 * Validates a Skill's description against the required shape.
 *
 * @param value - The candidate description, typically read straight from
 * frontmatter and not yet known to be a string.
 * @returns `string`
 * @throws SkillValidationError with rule `description_required` if `value`
 * is missing, not a string, or blank, or `description_too_long` if it
 * exceeds `SKILL_DESCRIPTION_MAX_LENGTH` characters.
 */
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

/**
 * Validates a Skill's body against the required shape.
 *
 * @param value - The candidate body, typically the SKILL.md content below
 * the frontmatter.
 * @returns `string`
 * @throws SkillValidationError with rule `body_required` if `value` is
 * missing, not a string, or blank.
 */
export function validateSkillBody(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SkillValidationError("body_required", "A Skill needs a SKILL.md body.", "body");
  }
  return value;
}

/**
 * Validates a Skill's optional `license` field.
 *
 * @param value - The candidate license, typically read straight from
 * frontmatter. `undefined` or `null` means the field was not set.
 * @returns `string | undefined` — `undefined` when the field was absent.
 * @throws SkillValidationError with rule `license_invalid` if `value` is
 * present but not a non-empty string.
 */
export function validateSkillLicense(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new SkillValidationError("license_invalid", "A Skill's license, if set, must be a non-empty string.", "license");
  }
  return value;
}

/**
 * Validates a Skill's optional `compatibility` field.
 *
 * @param value - The candidate compatibility note, typically read straight
 * from frontmatter. `undefined` or `null` means the field was not set.
 * @returns `string | undefined` — `undefined` when the field was absent.
 * @throws SkillValidationError with rule `compatibility_invalid` if `value`
 * is present but not a string, or `compatibility_too_long` if it exceeds
 * `SKILL_COMPATIBILITY_MAX_LENGTH` characters.
 */
export function validateSkillCompatibility(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new SkillValidationError(
      "compatibility_invalid",
      "A Skill's compatibility, if set, must be a string.",
      "compatibility",
    );
  }
  if (value.length > SKILL_COMPATIBILITY_MAX_LENGTH) {
    throw new SkillValidationError(
      "compatibility_too_long",
      `A Skill's compatibility is at most ${SKILL_COMPATIBILITY_MAX_LENGTH} characters.`,
      "compatibility",
    );
  }
  return value;
}

/**
 * Validates a Skill's optional `metadata` field.
 *
 * @param value - The candidate metadata, typically read straight from
 * frontmatter. `undefined` or `null` means the field was not set.
 * @returns `Record<string, string> | undefined` — `undefined` when the
 * field was absent.
 * @throws SkillValidationError with rule `metadata_invalid` if `value` is
 * present but not a plain object, or any of its values is not a string.
 */
export function validateSkillMetadata(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new SkillValidationError(
      "metadata_invalid",
      "A Skill's metadata, if set, must be a mapping of string keys to string values.",
      "metadata",
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([, entryValue]) => typeof entryValue !== "string")) {
    throw new SkillValidationError(
      "metadata_invalid",
      "A Skill's metadata, if set, must be a mapping of string keys to string values.",
      "metadata",
    );
  }
  return value as Record<string, string>;
}

/**
 * Validates a Skill's optional `allowed-tools` field.
 *
 * @remarks
 * The specification treats this field's internal grammar as experimental
 * (docs/adr — see the Agent Skills specification), so only its type is
 * checked here, not the tool patterns it names.
 *
 * @param value - The candidate allowed-tools string, typically read
 * straight from frontmatter. `undefined` or `null` means the field was not
 * set.
 * @returns `string | undefined` — `undefined` when the field was absent.
 * @throws SkillValidationError with rule `allowed_tools_invalid` if `value`
 * is present but not a string.
 */
export function validateSkillAllowedTools(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new SkillValidationError(
      "allowed_tools_invalid",
      "A Skill's allowed-tools, if set, must be a string.",
      "allowed_tools",
    );
  }
  return value;
}
