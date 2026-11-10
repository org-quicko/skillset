/**
 * The Subagent validation rules (ADR-0046). A Subagent's `name` and
 * `description` share a Skill's shape, so the pattern and ceilings come from
 * `skill-rules.ts`; what is here is the wording a User reads and the rules
 * only a Subagent has.
 */
import { validateManifestEntries } from "./artifact.js";
import { isNonBlankString, isWithinMaxLength, matchesPattern } from "./resource-rules.js";
import type { ArtifactFile } from "./skill.js";
import {
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_NAME_MAX_LENGTH,
  SKILL_NAME_PATTERN,
  SkillValidationError,
} from "./skill-rules.js";

/**
 * The one file a Subagent's Artifact holds.
 *
 * @param name - The Subagent's name.
 * @returns `<name>.md`.
 * @example
 * ```ts
 * subagentFileName("code-reviewer"); // -> "code-reviewer.md"
 * ```
 */
export function subagentFileName(name: string): string {
  return `${name}.md`;
}

/**
 * Validates a Subagent's name against the required shape.
 *
 * @param value - The candidate name, not yet known to be a string.
 * @returns The name.
 * @throws SkillValidationError with rule `name_required` if `value` is
 * missing or not a string, `name_too_long` if it exceeds
 * `SKILL_NAME_MAX_LENGTH` characters, or `name_invalid` if it doesn't match
 * the required pattern.
 * @example
 * ```ts
 * validateSubagentName("code-reviewer"); // -> "code-reviewer"
 * ```
 */
export function validateSubagentName(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new SkillValidationError("name_required", "A Subagent needs a name in its frontmatter.", "name");
  }
  if (!isWithinMaxLength(value, SKILL_NAME_MAX_LENGTH)) {
    throw new SkillValidationError("name_too_long", `A Subagent's name is at most ${SKILL_NAME_MAX_LENGTH} characters.`, "name");
  }
  if (!matchesPattern(value, SKILL_NAME_PATTERN)) {
    throw new SkillValidationError(
      "name_invalid",
      "A Subagent's name is lowercase alphanumerics and hyphens, with no leading, trailing, or doubled hyphen.",
      "name",
    );
  }
  return value;
}

/**
 * Validates a Subagent's description against the required shape.
 *
 * @param value - The candidate description, not yet known to be a string.
 * @returns The description.
 * @throws SkillValidationError with rule `description_required` if `value`
 * is missing, not a string, or blank, or `description_too_long` if it
 * exceeds `SKILL_DESCRIPTION_MAX_LENGTH` characters.
 * @example
 * ```ts
 * validateSubagentDescription("Reviews a diff for correctness.");
 * ```
 */
export function validateSubagentDescription(value: unknown): string {
  if (!isNonBlankString(value)) {
    throw new SkillValidationError("description_required", "A Subagent needs a description in its frontmatter.", "description");
  }
  if (!isWithinMaxLength(value, SKILL_DESCRIPTION_MAX_LENGTH)) {
    throw new SkillValidationError(
      "description_too_long",
      `A Subagent's description is at most ${SKILL_DESCRIPTION_MAX_LENGTH} characters.`,
      "description",
    );
  }
  return value;
}

/**
 * Validates a Subagent's body, which is its system prompt.
 *
 * @param value - The candidate body: the file's content below the frontmatter.
 * @returns The body.
 * @throws SkillValidationError with rule `body_required` if `value` is
 * missing, not a string, or blank.
 * @example
 * ```ts
 * validateSubagentBody("You are a careful reviewer.");
 * ```
 */
export function validateSubagentBody(value: unknown): string {
  if (!isNonBlankString(value)) {
    throw new SkillValidationError("body_required", "A Subagent needs a system prompt below its frontmatter.", "body");
  }
  return value;
}

function optionalNonBlank(value: unknown, rule: "tools_invalid" | "model_invalid", field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isNonBlankString(value)) {
    throw new SkillValidationError(rule, `A Subagent's ${field}, if set, must be a non-empty string.`, field);
  }
  return value;
}

/**
 * Validates a Subagent's optional `tools` field.
 *
 * @param value - The candidate value, already folded from a YAML list to a
 * comma-separated string where one was written. `undefined` or `null` means
 * the field was not set.
 * @returns The string, or `undefined` when the field was absent.
 * @throws SkillValidationError with rule `tools_invalid` if `value` is
 * present but not a non-blank string.
 * @example
 * ```ts
 * validateSubagentTools("Read, Grep"); // -> "Read, Grep"
 * ```
 */
export function validateSubagentTools(value: unknown): string | undefined {
  return optionalNonBlank(value, "tools_invalid", "tools");
}

/**
 * Validates a Subagent's optional `model` field.
 *
 * @param value - The candidate value. `undefined` or `null` means the field
 * was not set.
 * @returns The string, or `undefined` when the field was absent.
 * @throws SkillValidationError with rule `model_invalid` if `value` is
 * present but not a non-blank string.
 * @example
 * ```ts
 * validateSubagentModel("sonnet"); // -> "sonnet"
 * ```
 */
export function validateSubagentModel(value: unknown): string | undefined {
  return optionalNonBlank(value, "model_invalid", "model");
}

/**
 * Validates the Manifest a Subagent publish declares: exactly one file, named
 * after the Subagent (ADR-0046).
 *
 * @param name - The Subagent's name, already validated.
 * @param value - The declared Manifest, not yet known to be one.
 * @returns The Manifest's single entry, in a list.
 * @throws SkillValidationError with one of `validateManifestEntries`'s
 * rules if `value` is not a valid Manifest, or `manifest_invalid` if it
 * holds anything other than the one file `<name>.md`.
 * @example
 * ```ts
 * validateSubagentManifest("code-reviewer", [{ path: "code-reviewer.md", size: 512 }]);
 * ```
 */
export function validateSubagentManifest(name: string, value: unknown): ArtifactFile[] {
  const files = validateManifestEntries(value);
  const expected = subagentFileName(name);
  if (files.length !== 1 || files[0]?.path !== expected) {
    throw new SkillValidationError("manifest_invalid", `A Subagent's Artifact is exactly one file, ${expected}.`, "files");
  }
  return files;
}
