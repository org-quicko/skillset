/**
 * Postgres error codes the services react to, rather than pre-validating
 * against rules of their own.
 *
 * @remarks
 * Letting Postgres reject the input means there is no second copy of a
 * constraint to drift from what the database actually enforces.
 */
const UNIQUE_VIOLATION = "23505";
const INVALID_TEXT_REPRESENTATION = "22P02";

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === code;
}

/**
 * Whether an error is Postgres's `unique_violation`.
 *
 * @remarks
 * Which constraint was violated is not distinguished — a caller uses this on a
 * statement whose only unique constraint it already knows.
 *
 * @param error - The caught error.
 * @returns `true` if Postgres raised 23505.
 * @example
 * ```ts
 * catch (cause) {
 *   if (isUniqueViolation(cause)) throw new EmailTakenError();
 *   throw cause;
 * }
 * ```
 */
export function isUniqueViolation(error: unknown): boolean {
  return hasCode(error, UNIQUE_VIOLATION);
}

/**
 * Whether an error is Postgres's `invalid_text_representation`, raised for a
 * malformed `uuid` literal.
 *
 * @remarks
 * A malformed id can never match a row, so callers treat this as "not found"
 * rather than pre-validating the format.
 *
 * @param error - The caught error.
 * @returns `true` if Postgres raised 22P02.
 * @example
 * ```ts
 * catch (cause) {
 *   if (isInvalidIdSyntax(cause)) throw new TagNotFoundError();
 *   throw cause;
 * }
 * ```
 */
export function isInvalidIdSyntax(error: unknown): boolean {
  return hasCode(error, INVALID_TEXT_REPRESENTATION);
}
