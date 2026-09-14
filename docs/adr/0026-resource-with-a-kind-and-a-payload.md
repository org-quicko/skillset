# A Resource Has a Kind and a JSONB Payload

The Registry holds **Resources**, not Skills. One `resources` table carries what every Kind has
in common — `id`, `kind`, `name`, `description`, `body`, publisher attribution, timestamps,
`search` — and one `payload jsonb` column carries everything a Kind has of its own, validated at
the edge by a `z.discriminatedUnion("kind", …)` in `@skill-registry/shared`. `kind` is plain
text, not an enum, and the values it may take are the keys of a `KINDS` map in shared, checked in
the service. `name` is unique on `(kind, name)`, and both `name` and `description` are validated
by that Kind's own rules. The Artifact's storage key is derived from the Resource's `id`, not its
name.

> **Amends ADR-0002.** Overwrite-instead-of-versioning is unchanged, and `name` is still the
> *publishing* identity `PUT` upserts by. Two halves of that ADR do change: `name` is now unique
> per Kind rather than registry-wide, and it no longer keys the Artifact in storage.

## Considered Options

**A flat table with every Kind's fields as nullable columns**, the shape `identity_providers`
already uses for its three kinds. It works there because the variance is three scalars and one
`text[]`. It collapses here: an MCP Server's payload is `packages[]` — each with `registryType`,
`identifier`, `transport`, `runtimeArguments`, `packageArguments`, `environmentVariables`,
`fileSha256` — plus `remotes[]` and nested `KeyValueInput` objects. Those are not columns.

**A core table plus a detail table per Kind.** Normalised, and the only option where Postgres
enforces the payload's shape. Rejected on cost: MCP Server alone needs three tables
(`mcp_packages`, `mcp_remotes`, `mcp_inputs`), every read grows a join, and every new Kind is a
migration. This is the option to revisit if payload-level querying in SQL ever becomes a
requirement — see the consequence below.

**A table per Kind with a union view for the catalog.** Rejected: it makes the shared
concerns — Tags, Install events, search, publisher attribution — either duplicated three times or
keyed against a view, and the one-catalog decision then has to be re-litigated per Kind.

**An enum for `kind`.** Rejected for ADR-0024's reason, verbatim: a plain-text discriminator makes
registering a new Kind an insert rather than a migration, and the service is already the place
this codebase validates such a value against a map in shared (`GIT_PROVIDERS`, and now `KINDS`).

## Consequences

`jsonb` costs no typesafety in *this* codebase specifically, and it is worth being precise about
why. Types here are `z.infer`red from the Zod schemas in `@skill-registry/shared`, not generated
from Drizzle — so a Drizzle row, a wire payload, and a TypeScript type already agree because the
Zod schema is the single source, and a payload validated by a discriminated union is as typed as
a column would be. `skills.metadata` was already `jsonb` on the same reasoning.

**What it does cost: Postgres enforces nothing about the payload.** This repo has repeatedly
chosen database-level invariants where it could — `connections.provider` references
`integrations.provider` specifically so that "you cannot connect to a provider this Registry has
not registered" is a database rule, not an application one. There is no equivalent here. A
hand-written `UPDATE`, or a bug that bypasses the shared schema, can store a payload no Kind
recognises, and nothing notices until something reads it.

Browsing, searching, filtering, and sorting never touch the payload. `resource_directory` is
built from core columns only — `name`, `description`, `published_by_name`, Tags, install
count — so no query has to reach inside `jsonb`. The day one does, that is the signal to
reconsider the detail-table option above rather than to add a GIN index on the payload.

Per-Kind name rules mean the shared `SKILL_NAME_PATTERN` stops being universal. A Skill's `name`
is 1–64 lowercase alphanumerics and hyphens; an MCP Server's is reverse-DNS with one slash,
3–200 characters, and permits dots and uppercase; a Plugin's is kebab-case. `description` splits
too — 1024 characters for a Skill, 100 for an MCP Server, both fixed upstream. The check
constraint on `skills.name` cannot follow this and is dropped: validation moves entirely to the
shared per-Kind validators, and the database keeps only the `(kind, name)` unique index.

Keying the Artifact on `id` removes the coupling that made the name's *shape* a storage concern.
An MCP Server's name contains a slash; had keys stayed name-derived, a name like
`io.github.acme/thing` would have silently created a nested object path. `id` is already stable
across every republish and never changes, so it is the honest key. Existing objects under
`skills/<name>.zip` are not migrated — nothing is deployed.
