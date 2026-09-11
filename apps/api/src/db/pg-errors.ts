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
// Postgres raises this specific code — not the more general 23503
// (`foreign_key_violation`) — when a statement is blocked by a `RESTRICT`
// foreign key, as opposed to the default `NO ACTION`.
const RESTRICT_VIOLATION = "23001";

/**
 * Whether `error`, or anything it wraps, carries a Postgres error code.
 *
 * @remarks
 * The chain is walked rather than the top-level error inspected, because
 * Drizzle wraps every driver error in a `DrizzleQueryError` and hangs the
 * real one off `cause`. Reading `error.code` alone therefore stopped
 * recognising a unique or restrict violation the moment Drizzle started
 * wrapping, which turned "that email is taken" into a 500.
 */
function hasCode(error: unknown, code: string): boolean {
  for (let current: unknown = error; current !== null && typeof current === "object"; ) {
    if ((current as { code?: string }).code === code) return true;
    const next: unknown = (current as { cause?: unknown }).cause;
    if (next === current) return false;
    current = next;
  }
  return false;
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

/**
 * Whether an error is Postgres's `restrict_violation` — a statement blocked
 * by a foreign key declared `ON DELETE RESTRICT` (or `ON UPDATE RESTRICT`).
 *
 * @remarks
 * Which constraint was violated is not distinguished — a caller uses this on
 * a statement whose only relevant `RESTRICT` FK it already knows.
 *
 * @param error - The caught error.
 * @returns `true` if Postgres raised 23001.
 * @example
 * ```ts
 * catch (cause) {
 *   if (isRestrictViolation(cause)) throw new IntegrationInUseError();
 *   throw cause;
 * }
 * ```
 */
export function isRestrictViolation(error: unknown): boolean {
  return hasCode(error, RESTRICT_VIOLATION);
}
