# Kysely, So the Schema Is Chosen at Runtime

The API talks to Postgres through Kysely on the `pg` driver, not Drizzle on postgres.js. The
database really is shared between apps, one schema each (ADR-0036), and Drizzle could only
support that by fixing the schema too early: when a table object was built on import, and when
drizzle-kit wrote a migration. Kysely applies the schema as each query is built.

## What changes

`createDatabase(url, schema)` returns a client already scoped with `withSchema(schema)`, so every
table a query, a Better Auth call, or a migration names is qualified without anyone writing the
schema down. The schema is ordinary config (`Config.dbSchema`), read and validated by
`readDbSchema` once at startup, instead of a property of the process bound at import time. A test
can therefore run against any schema in the same process.

`withSchema` qualifies tables, joins, foreign keys, enum types, indexes, and views, including in
the schema builder. It does not reach inside raw `sql` text, `sql.table()`, or an enum column
type written as raw SQL. Anything naming a table there uses `sql.id(schema, name)`.

Types come from kysely-codegen (`bun run db:types`), generated from a throwaway database
migrated from scratch rather than hand-kept beside the migrations. `db:types:check` fails when
they are stale. The overrides in `.kysely-codegenrc.json` carry what Postgres cannot report: the
shape of a jsonb column, and that a view's columns are not null.

Migrations are written by hand with Kysely's schema builder under `src/db/migrations/`, each
handed the schema name for the few places `withSchema` cannot reach. Kysely has no generator that
diffs a schema into a migration, and drizzle-kit's had already been bypassed for the last two
migrations here.

## A new baseline, not the old history

The SQL drizzle generated is not carried over. `0000_baseline.ts` rebuilds the schema as it stood,
table for table, with the same constraint and index names, and was checked against a database
built from the old SQL by comparing Postgres's own catalog: columns, generated expressions,
defaults, constraints, indexes, enums, and view definitions all matched. With it went the
`__db_schema__` and `__registry_namespace__` sentinels; the Namespace one existed only to backfill
rows that a fresh baseline does not have.

The cost is that a database drizzle already migrated cannot be brought forward in place: the
baseline would try to create tables that already exist. Such a database is recreated, or its
schema dropped, before the first start on Kysely.

## Considered options

**Keep Drizzle and its schema factory.** It worked, but only through `appTable` and friends bound
at import, a `drizzle.config.ts` that forced the sentinel into the environment before drizzle-kit
loaded, and a temp-directory copy of every migration with the sentinel replaced. All of that
existed to work around when Drizzle decides the schema.

**Keep the drizzle SQL as frozen legacy migrations**, skipping each one a database's
`__drizzle_migrations` already records. It carried existing databases across in place, but kept
the sentinels and a second kind of migration for good. Rejected in favour of one baseline.

**Keep drizzle-kit for DDL and Kysely for queries.** This keeps generated migrations, but also
keeps everything above, and two descriptions of the same tables.

**A SQL diff tool (Atlas, pg-schema-diff) for generated migrations.** Rejected for now: it would
add an external binary and a desired-state schema file to keep, for a schema that changes rarely.

**`kysely-postgres-js`, to stay on postgres.js.** Rejected in favour of Kysely's built-in
`PostgresDialect` on `pg`, so the driver is the one Kysely itself maintains.
