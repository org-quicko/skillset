/**
 * The Tag validation rules, in one place — mirrors skill-rules.ts's pattern
 * so a Tag rejected by the API is rejected for the same stated reason the
 * web interface would show before it ever sends the request.
 *
 * A failure carries a `rule` and, where there is one, the `field` that broke
 * it. Both land verbatim in the API's error body as `code` and `field`.
 */

export const TAG_NAME_MAX_LENGTH = 32;

/** Lowercase alphanumerics and hyphens; no leading, trailing, or doubled hyphen — same shape as a Skill's name. */
export const TAG_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type TagRule = "name_required" | "name_too_long" | "name_invalid" | "tags_invalid";

/**
 * Thrown when a Tag name fails one of the shared validation rules. Carries
 * the specific `rule` that was broken and, where there is one, the `field` —
 * both of which land verbatim in the API's error body.
 */
export class TagValidationError extends Error {
  readonly rule: TagRule;
  readonly field: string | undefined;

  /**
   * @param rule - The specific rule that was broken.
   * @param message - A human-readable description of the failure.
   * @param field - The request field the failure relates to, if any.
   */
  constructor(rule: TagRule, message: string, field?: string) {
    super(message);
    this.name = "TagValidationError";
    this.rule = rule;
    this.field = field;
  }
}

/**
 * Validates and normalises a candidate Tag name.
 *
 * @remarks
 * Normalises before validating, not after: a name is lowercased and trimmed
 * first, then checked against the length and pattern rules, so `"AI"` and
 * `"ai"` validate identically and resolve to the same catalog row rather
 * than one being rejected on casing alone.
 *
 * @param value - The candidate name, typically read straight from a request
 * body and not yet known to be a string.
 * @returns The normalised (trimmed, lowercased) name.
 * @throws TagValidationError with rule `name_required` if `value` is
 * missing, not a string, or blank; `name_too_long` if the normalised name
 * exceeds `TAG_NAME_MAX_LENGTH` characters; or `name_invalid` if it doesn't
 * match the required pattern.
 * @example
 * ```ts
 * validateTagName("Code Review"); // throws name_invalid — no spaces
 * validateTagName(" AI "); // "ai"
 * ```
 */
export function validateTagName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TagValidationError("name_required", "A Tag needs a non-empty name.", "name");
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length > TAG_NAME_MAX_LENGTH) {
    throw new TagValidationError(
      "name_too_long",
      `A Tag's name is at most ${TAG_NAME_MAX_LENGTH} characters.`,
      "name",
    );
  }
  if (!TAG_NAME_PATTERN.test(normalized)) {
    throw new TagValidationError(
      "name_invalid",
      "A Tag's name is lowercase alphanumerics and hyphens, with no leading, trailing, or doubled hyphen.",
      "name",
    );
  }
  return normalized;
}

/**
 * Validates a full-replace Skill tags list — `PUT /skills/{id}/tags`'s
 * `tags` field.
 *
 * @remarks
 * Every element is validated and normalised with `validateTagName`, then
 * deduplicated — a submission repeating a name (even under different
 * casing, e.g. `["AI", "ai"]`) still resolves to one Tag, not two.
 *
 * @param value - The candidate tags list, typically a request body's `tags`
 * field and not yet known to be an array.
 * @returns The normalised, deduplicated names, in first-seen order.
 * @throws TagValidationError with rule `tags_invalid` if `value` is not an
 * array, or any element fails `validateTagName`.
 */
export function validateTagNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new TagValidationError("tags_invalid", "A Skill's tags must be an array of names.", "tags");
  }
  return Array.from(new Set(value.map((raw) => validateTagName(raw))));
}
