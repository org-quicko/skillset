/**
 * The schema Postgres resolves an unqualified name to, and what an unset
 * `DB_SCHEMA` is taken to mean.
 */
export const DEFAULT_DB_SCHEMA = "public";

/**
 * The schema name the generated SQL in `drizzle/` is written against, standing
 * in for whatever schema the deployment chose.
 *
 * @remarks
 * drizzle-kit resolves a schema name at *generate* time and writes it into the
 * SQL as a literal — enum types and foreign key references are both fully
 * qualified — so the shipped files cannot carry a real one: they are built
 * once and the operator's choice is not known until they run. They carry this
 * instead, and `runMigrations` substitutes it, the way supabase/auth's
 * migrations carry `{{ index .Options "Namespace" }}`.
 *
 * `drizzle.config.ts` forces this into the environment before drizzle-kit
 * loads the schema files, so a generated migration is a template no matter how
 * `db:generate` happened to be invoked.
 *
 * Deliberately not a plausible schema name: substituting it is a blind string
 * replacement, and it must never collide with a real identifier.
 */
export const MIGRATION_SCHEMA_SENTINEL = "__db_schema__";

/**
 * The Namespace sentinel the shipped SQL carries, standing in for the
 * Namespace anything published straight to this deployment is named by
 * (ADR-0042).
 *
 * @remarks
 * Here for the same reason as {@link MIGRATION_SCHEMA_SENTINEL}: the value is
 * `PUBLIC_URL`'s host, which is not known when the SQL is written, and
 * `0006_resource_namespace.sql` has to write it into every pre-existing row to
 * make the column `NOT NULL`. `runMigrations` substitutes it.
 *
 * Substituted as plain text, so the value is checked against
 * `isNamespace` before it goes anywhere near the SQL — the same boundary
 * `readDbSchema` is for the schema name. A Namespace is lowercase
 * alphanumerics, dots, hyphens and at most one slash, which leaves nothing a
 * quote could escape into.
 *
 * Deliberately not a plausible value: substituting it is a blind string
 * replacement, and it must never collide with a real host.
 */
export const MIGRATION_NAMESPACE_SENTINEL = "__registry_namespace__";

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
 * Validated rather than taken as given because the name reaches Postgres two
 * ways, and only one of them quotes it: Drizzle escapes the identifier it
 * builds queries from, but `runMigrations` substitutes this into shipped SQL
 * as plain text. This is the boundary that keeps that from being a place to
 * inject.
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
