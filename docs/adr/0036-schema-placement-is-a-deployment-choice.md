# Schema Placement Is a Deployment Choice

The Registry's Postgres objects live in whatever schema the operator names in `DB_SCHEMA`, not in
`public`. The database this runs against is meant to be divided by schema — one per app — rather
than dedicated to the Registry alone, and which schema the Registry gets is not known when the
migrations are built.

## What the choice costs

Drizzle binds a table to its schema when the table object is *constructed*, on import, long before
any config exists. So the schema cannot be passed in; it has to be read from the environment at
module load. `src/db/schemaFactory.ts` is the one place that happens, and every table, enum, and
view in `src/db/schemas` is declared through the `appTable` / `appEnum` / `appView` /
`appMaterializedView` helpers it exports rather than drizzle-orm's top-level constructors. That
makes the schema a property of the process: a test that needs a different one runs in its own.

`public` is not `pgSchema("public")`. drizzle-orm refuses that outright, because Postgres already
resolves an unqualified name to `public` and declaring it explicitly writes `"public"."users"` into
every statement. So the helpers hand back drizzle-orm's own constructors on `public` and the
schema's equivalents otherwise. Each pair shares a call signature, so a schema file, a query, and a
route all read the same either way, and the inferred row types are identical.

All four constructors are built together, from one decision, rather than as four independent
helpers. An enum or a view left behind in `public` while its tables moved is the failure this
shape rules out — it would not surface until a query missed.

## Migrations carry a sentinel

drizzle-kit resolves a schema name at *generate* time and writes it into the SQL as a literal —
enum types and foreign key references are both fully qualified, so `search_path` cannot relocate
them afterwards. The shipped files therefore cannot carry a real schema name: they are built once,
and the operator's choice is not known until they run.

They carry `__db_schema__` instead, and `runMigrations` substitutes it into a temporary copy before
handing that to drizzle's migrator — the same shape as supabase/auth's migrations carrying
`{{ index .Options "Namespace" }}`. `drizzle.config.ts` forces the sentinel into the environment
before drizzle-kit loads the schema files, so a generated migration is a template no matter how
`db:generate` was invoked. `migrations.test.ts` fails the build if a migration names a real schema,
because hand-written SQL is where that is lost.

Two consequences follow. `DB_SCHEMA` is validated as a plain lower-case identifier, since it
reaches Postgres as text and not only through Drizzle's quoting. And drizzle's own bookkeeping
table goes into the same schema as the objects it describes, so two apps sharing one database do
not read each other's applied migrations out of a single `drizzle.__drizzle_migrations`.

## Considered options

**Leave everything in `public` and set `search_path` on the connection.** What the Registry did
before. Rejected on the same fact that forces the sentinel: the generated SQL qualifies enum types
and foreign key references with `public` explicitly, so a `search_path` pointed elsewhere creates
the tables in one schema and fails on the first constraint that references another. It also leaves
the schema itself uncreated — Postgres never creates one on its own.

**Create the schema from the Postgres image's init hooks** (`docker-entrypoint-initdb.d`). What
`network/postgres-init/01-create-schema.sh` did. Rejected because those hooks only fire on a fresh
data directory, so a schema introduced after the volume was made is never created, and because it
puts a piece of the application's own setup somewhere only one deployment method can reach.
`runMigrations` creates it instead.

**Generate the migrations per deployment**, with the real `DB_SCHEMA` set. Rejected: migrations
would stop being portable, and a deployment could not be handed the same artifact as any other.
