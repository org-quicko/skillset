/**
 * Generic per-Kind validation building blocks (ADR-0026). Every Kind's name
 * and description validators repeat the same shape — required, non-blank,
 * and bounded by length, with a name also matching a pattern — and only the
 * ceiling and pattern differ per Kind. These are the pieces that generalise;
 * the specific rule codes, messages, and the error thrown stay with each
 * Kind's own module (e.g. `skill-rules.ts`), since those are what a caller
 * reports back to a User and they read differently per Kind.
 */

/** Whether `value` is a string with at least one non-whitespace character. */
export function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Whether `value` is no longer than `maxLength` characters. */
export function isWithinMaxLength(value: string, maxLength: number): boolean {
  return value.length <= maxLength;
}

/** Whether `value` matches `pattern` in full. */
export function matchesPattern(value: string, pattern: RegExp): boolean {
  return pattern.test(value);
}
