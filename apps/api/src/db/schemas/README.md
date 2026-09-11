# Schemas

One table or view per file, re-exported from `index.ts`. Add a file, export it
from the barrel, then `bun run db:generate`.

## The Better Auth tables

`user.ts`, `session.ts`, `account.ts`, and `verification.ts` are Better Auth's
models, not ours (ADR-0016). Their column set comes from the CLI, not from
hand-editing:

```bash
bunx @better-auth/cli@latest generate --config src/features/auth/cli.ts --output ./src/db/generated-auth-schema.ts
```

`src/features/auth/cli.ts` exists only to give the CLI an `auth` export to read; the
generated file is a throwaway to diff against, not something to commit.

The CLI cannot know three things about this schema, so its output is reconciled
by hand each time:

- **ids are `uuid` with a `uuidv7()` default**, not `text`. `generateId: false`
  in `auth/instance.ts` hands id generation to Postgres, and the rest of the
  schema references `users.id` as a uuid.
- **timestamps carry `withTimezone: true`**, matching every other table here.
- **`users.name` is a generated column** over `first_name || ' ' || last_name`,
  and `role` / `must_change_password` are `notNull` even though the CLI emits
  them as nullable `additionalFields` (docs/data-model.md).

The published CLI (1.4.21) also lags the installed `better-auth` (1.7.2): it
omits `accounts.issuer` entirely, which 1.7 requires and matches an account on.
The column is kept here, under a unique index over `(provider_id, issuer,
account_id)` — wider than the `(issuer, account_id)` 1.7 declares, and the
`ON CONFLICT` target `setPasswordCredential` upserts against. Check the CLI
output against `getAuthTables` in `@better-auth/core` when upgrading either.

## Why the imports here have no `.js`

Every other module in this app imports with an explicit `.js` extension. The
files in this directory are the exception: `drizzle-kit` 0.28 loads the schema
through CJS `require`, which does not map `./user.js` back to `./user.ts`, so a
`.js` import here fails `db:generate` with `Cannot find module`. `Bundler`
module resolution makes the extensionless form correct for both TypeScript and
Bun. Revisit once `drizzle-kit` is upgraded past 0.31 (which needs a matching
`drizzle-orm` bump).

## Views

`skill_analytics` and `skill_directory` are declared `.existing()` — Drizzle
generates no DDL for a view, so `drizzle/0001_views.sql` creates both by hand
and `db:generate` leaves them alone. Changing either means editing that SQL and
adding a `generate --custom` migration; the declaration here only types the
queries that read from them.
