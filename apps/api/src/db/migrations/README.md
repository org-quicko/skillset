# Migrations

Hand-written Kysely migrations, one file each, run by `runMigrations` in name
order. `0000_baseline.ts` is the whole schema as it stood when the Registry
moved to Kysely (ADR-0045); every change since is a migration after it.

- Name a file with the next four-digit number: `0001_<what>.ts`, and register
  it in `index.ts` under the same name. The migrator orders by name.
- Export `up(db, schema)`. `db` is typed `Kysely<unknown>`: a migration
  describes the schema at one point in time, not today's generated types.
- `db` is already scoped to the schema through `withSchema`, so write table
  names unqualified. That covers tables, foreign keys, indexes, views, and
  `createType` enums. It does **not** reach inside raw `sql` text,
  `sql.table()`, or a column typed by an enum — name those with
  `sql.id(schema, "...")`, which is what `schema` is for.
- Afterwards run `bun run db:types` to regenerate `src/db/database.ts`.

```ts
import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("tags").addColumn("colour", "text").execute();
}
```

## The Better Auth tables

`users`, `sessions`, `accounts`, `verifications`, and `rate_limits` are Better
Auth's models, not ours (ADR-0016), and it reads and writes them through the
same Kysely client as everything else. Check a Better Auth upgrade against what
its CLI would create:

```bash
bunx @better-auth/cli@latest generate --config src/features/auth/cli.ts --output ./generated-auth.sql
```

`src/features/auth/cli.ts` exists only to give the CLI an `auth` export to read;
the output is a throwaway to diff against, never a migration to ship. The CLI
cannot know three things about this schema, so a difference here is expected:

- **ids are `uuid` with a `uuidv7()` default**, not `text`. `generateId: false`
  in `auth/instance.ts` hands id generation to Postgres, and the rest of the
  schema references `users.id` as a uuid.
- **timestamps are `timestamptz`**, matching every other table here.
- **`users.name` is a generated column** over `first_name || ' ' || last_name`,
  and `role` / `must_change_password` are `NOT NULL` even though the CLI emits
  them as nullable `additionalFields` (docs/data-model.md).

`auth-schema.test.ts` is what fails the build when a field Better Auth expects
has no column behind it.
