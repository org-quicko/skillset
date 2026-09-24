/**
 * The schema Postgres resolves an unqualified name to, and what an unset
 * `DB_SCHEMA` is taken to mean.
 */
export const DEFAULT_DB_SCHEMA = "public";

/** Postgres truncates an identifier past this, silently. */
const MAX_IDENTIFIER_LENGTH = 63;

/**
 * Lower case only, because Postgres folds an unquoted identifier down and
 * `DB_SCHEMA=Registry` quietly becoming `registry` is worse than an error.
 */
const SCHEMA_NAME_PATTERN = /^[a-z_][a-z0-9_$]*$/;

/**
 * Reads a raw `DB_SCHEMA` value into a schema name.
 *
 * @remarks
 * Validated rather than taken as given, so a name Postgres would silently
 * truncate or refuse fails at startup instead of on the first query. Lower
 * case only: Kysely quotes the identifier, and a quoted `Registry` would be a
 * different schema from the `registry` anything unquoted resolves to.
 *
 * @param raw - The value of `DB_SCHEMA`, or undefined when it is unset.
 * @returns The schema name, or `public` when unset or blank.
 * @throws Error if the value is not a lower-case Postgres identifier of at
 * most 63 characters, or uses the `pg_` prefix Postgres reserves.
 * @example
 * ```ts
 * readDbSchema("acme_registry"); // "acme_registry"
 * readDbSchema(undefined); // "public"
 * ```
 */
export function readDbSchema(raw: string | undefined): string {
  const dbSchema = raw?.trim();
  if (!dbSchema) return DEFAULT_DB_SCHEMA;

  if (!SCHEMA_NAME_PATTERN.test(dbSchema) || dbSchema.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(
      `Invalid environment variable DB_SCHEMA: "${dbSchema}" is not a plain lower-case Postgres identifier of at most ${MAX_IDENTIFIER_LENGTH} characters.`,
    );
  }
  // Reserved by Postgres for system catalogs and temp schemas; creating one is
  // refused by the server anyway, so this fails at startup instead.
  if (dbSchema.startsWith("pg_")) {
    throw new Error(`Invalid environment variable DB_SCHEMA: "${dbSchema}" uses the reserved "pg_" prefix.`);
  }

  return dbSchema;
}
