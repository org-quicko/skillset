import {
  pgEnum,
  pgMaterializedView,
  pgSchema,
  pgTable,
  pgView,
  type PgTableFn,
} from "drizzle-orm/pg-core";
import { DEFAULT_DB_SCHEMA, readDbSchema } from "./schemaName.js";

/**
 * The four object constructors a schema file declares through, each bound to
 * one schema.
 */
export interface SchemaBuilders {
  table: PgTableFn<string | undefined>;
  enum: typeof pgEnum;
  view: typeof pgView;
  materializedView: typeof pgMaterializedView;
}

/**
 * Builds the constructors for one schema.
 *
 * @remarks
 * `pgSchema("public")` throws: drizzle-orm refuses it outright, because
 * Postgres already resolves an unqualified name to `public` and a table
 * declared with `schema: "public"` would be written as `"public"."users"`
 * into every statement and every generated migration. So `public` takes
 * drizzle-orm's top-level constructors and any other name takes the
 * equivalents off `pgSchema(name)`. Each pair shares a call signature, so
 * nothing downstream learns which one it got.
 *
 * All four are returned together rather than as four independent helpers so
 * that the choice of schema is made in exactly one place — an enum or a view
 * left behind in `public` while its tables moved is the failure mode this
 * shape rules out.
 *
 * `enum` is a real method and is bound, unlike the other three, which
 * drizzle-orm declares as arrow-function properties that keep their schema
 * once detached.
 *
 * @param schemaName - The Postgres schema to declare objects under.
 * @returns Constructors with drizzle-orm's own signatures, bound to `schemaName`.
 * @example
 * ```ts
 * const { table } = createSchemaBuilders("acme");
 * const users = table("users", { id: uuid("id").primaryKey() });
 * // => SELECT ... FROM "acme"."users"
 * ```
 */
export function createSchemaBuilders(schemaName: string): SchemaBuilders {
  if (schemaName === DEFAULT_DB_SCHEMA) {
    return { table: pgTable, enum: pgEnum, view: pgView, materializedView: pgMaterializedView };
  }

  const schema = pgSchema(schemaName);
  return {
    table: schema.table,
    enum: schema.enum.bind(schema),
    view: schema.view,
    materializedView: schema.materializedView,
  };
}

/**
 * The schema every object declared through the helpers below lands in.
 *
 * @remarks
 * Read at module load rather than passed in as config: Drizzle binds a table
 * to its schema when the table object is built, which happens on import —
 * before any config has been assembled. The schema is therefore a property of
 * the process, and a test that needs a different one runs in its own.
 */
export const dbSchema: string = readDbSchema(process.env.DB_SCHEMA);

const builders = createSchemaBuilders(dbSchema);

/**
 * Declares a table in whichever schema `DB_SCHEMA` names — a drop-in
 * replacement for drizzle-orm's `pgTable`.
 *
 * @remarks
 * Takes the same three arguments as `pgTable` and returns the same table
 * object, so a table's name and its inferred row types are identical whatever
 * `DB_SCHEMA` is set to. Only the schema its queries are qualified with
 * changes.
 *
 * Use this — and its siblings {@link appEnum}, {@link appView}, and
 * {@link appMaterializedView} — for every object in `./schemas`, so that no
 * schema file, query, or route has to know which schema is active.
 *
 * @example
 * ```ts
 * export const users = appTable(
 *   "users",
 *   { id: uuid("id").primaryKey(), email: text("email").notNull() },
 *   (table) => [uniqueIndex("users_email_index").on(table.email)],
 * );
 * ```
 */
export const appTable: PgTableFn<string | undefined> = builders.table;

/** Declares an enum type in the active schema — see {@link appTable}. */
export const appEnum: typeof pgEnum = builders.enum;

/** Declares a view in the active schema — see {@link appTable}. */
export const appView: typeof pgView = builders.view;

/** Declares a materialized view in the active schema — see {@link appTable}. */
export const appMaterializedView: typeof pgMaterializedView = builders.materializedView;
