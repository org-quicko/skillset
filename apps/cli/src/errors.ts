import { formatSkillValidationError, SkillValidationError } from "@skillset/shared";

/**
 * Turns a shared-rules validation failure into the one-line, rule-naming message the CLI
 * prints (via `formatSkillValidationError`, shared with every other surface that catches one),
 * and passes anything else through untouched.
 *
 * Both the local check `publish` runs and the Artifact inspection `add` runs raise
 * `SkillValidationError`, and both owe the User the rule's name rather than a bare sentence.
 *
 * @param error - Whatever was caught.
 * @returns Never; it always throws. Declared `never` so a `try`/`catch` around an
 * assignment still narrows the assigned variable as definitely assigned afterwards.
 * @throws Error naming the rule, the message, and the field when `error` is a
 * `SkillValidationError`; otherwise rethrows `error` exactly as it arrived.
 *
 * @example
 * ```ts
 * let bundle;
 * try {
 *   bundle = buildSkillBundle(files);
 * } catch (error) {
 *   rethrowValidationError(error); // "name_invalid: A Skill's name is ... (name)"
 * }
 * ```
 */
export function rethrowValidationError(error: unknown): never {
  if (error instanceof SkillValidationError) {
    throw new Error(formatSkillValidationError(error));
  }
  throw error;
}
