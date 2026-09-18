# Data Model

Postgres 18. Twelve tables, one materialized view, and one plain view. One table or view per file
under `apps/api/src/db/schemas/`, managed with Drizzle migrations. Both views are created in
hand-written SQL because Drizzle has no generator for a view (ADR-0012); everything else,
generated columns and check constraints included, comes out of `bun run db:generate`.

Terms are as defined in [CONTEXT.md](../CONTEXT.md) — User, Admin, Skill, Artifact, Token, Tag,
Git Provider, Integration, Connection, Import.

Column names are snake_case, and so are the JSON keys in [openapi.json](./openapi.json) and every
TypeScript type — there is no separate camelCase domain shape or conversion boundary. Types are
`z.infer`red from the Zod schemas in `@in-org-quicko/skillset-shared`, so a Drizzle row, a wire payload,
and a TypeScript type all agree on the same field names by construction. A column name appearing
in a wire payload is therefore expected, not a leak.

## `users`

A User of the Registry.

| Column                 | Type          | Constraints                                       |
| ---------------------- | ------------- | ------------------------------------------------- |
| `id`                   | `uuid`        | primary key, default `uuidv7()`                   |
| `email`                | `text`        | not null, unique                                  |
| `first_name`           | `text`        | not null                                          |
| `last_name`            | `text`        | not null                                          |
| `name`                 | `text`        | not null, generated from the two halves below     |
| `email_verified`       | `boolean`     | not null, default `false`                         |
| `image`                | `text`        | null                                              |
| `role`                 | `user_role`   | not null                                          |
| `must_change_password` | `boolean`     | not null, default `false`                         |
| `created_at`           | `timestamptz` | not null, default `now()`                         |
| `updated_at`           | `timestamptz` | not null, default `now()`                         |

`user_role` is an enum: `reader`, `writer`, `admin`, `superadmin`. A partial unique index
(`users_role_superadmin_index`, on `role` where `role = 'superadmin'`) enforces that at most one
row ever holds it — the one thing about the Superadmin invariant the schema *can* express.
That the role is never reassigned once set, or removed from the User holding it, is an
application rule; see "Rules the schema cannot express" below.

Email is the identifier. It is normalised to lowercase on write so that the unique
constraint means what a person expects it to mean.

There is no `password_hash` column any more. The hash moved into `accounts` when Better Auth
took over authentication (ADR-0016); it is still argon2id from the runtime's built-in hashing,
and still never plaintext. A row in this table means a User exists, not that a password
exists — a User who authenticates through an Identity Provider has no credential row at all
(ADR-0007), so every path that reads one must tolerate its absence.

`name`, `email_verified`, and `image` belong to Better Auth's user model rather than to this
domain. `name` is **generated**, not written: Postgres derives it from `first_name` and
`last_name`, so a rename through `PATCH /users/me` cannot leave the two out of step and there
is no write path to keep in sync. Nothing may insert into it.

`email_verified` is set on every User the Registry creates, and does not mean the address was
challenged — nothing here sends email. It means the Registry stands behind the address, which is
already what CONTEXT.md means by calling the email the identity. It has to be set: Better Auth
refuses to link a Provider login to an unverified row, so a User created with it false could never
sign in through a Provider (ADR-0016).

`must_change_password` is set when an Admin creates a User with a generated password, and
cleared when that User replaces it. While set, every route except replacing their own
password and reading their own record is refused. It is meaningful only for Users who have
a password.

Indexes: unique on `email`.

## `tokens`

A Token a User mints for the CLI.

| Column         | Type          | Constraints                                          |
| -------------- | ------------- | ---------------------------------------------------- |
| `id`           | `uuid`        | primary key, default `uuidv7()`                      |
| `user_id`      | `uuid`        | not null, references `users(id)` on delete cascade   |
| `name`         | `text`        | not null                                             |
| `token_hash`   | `text`        | not null, unique — SHA-256 hex, see below            |
| `created_at`   | `timestamptz` | not null, default `now()`                            |
| `updated_at`   | `timestamptz` | not null, default `now()` — bumped alongside `last_used_at` |
| `last_used_at` | `timestamptz` | null until first use                                 |

Only the hash is stored — the secret is shown once at creation and is not recoverable.
Tokens do not expire; revocation is deleting the row. A Token carries no role of its own:
authorisation resolves the owner's current role on every request, so a demotion applies to
existing Tokens immediately.

**`token_hash` is a SHA-256 digest, not an argon2id one.** A Token is a 256-bit random
secret, so a slow key-derivation function buys no brute-force resistance it does not
already have from its entropy — and it would add KDF latency to every single CLI request.
Passwords are the opposite case: low entropy, guessable, hashed once per login, so they
keep argon2id. Compare the digest in **constant time**; a short-circuiting comparison on a
credential is a timing oracle. This split follows listmonk, which hashes API tokens with
SHA-256 and compares them with a constant-time primitive.

Cascade on delete is deliberate — removing a User must end their CLI access, not orphan it.

Indexes: unique on `token_hash`; on `user_id` for listing a User's own Tokens.

## `resources`

A Resource in the Registry — a Skill, and eventually other Kinds (ADR-0026). One row per
Resource, one Artifact per row for a Kind that has one (ADR-0027). Replaces `skills`; `skill` is
the only Kind registered so far, so every row here is one today.

| Column               | Type          | Constraints                                            |
| -------------------- | ------------- | ------------------------------------------------------ |
| `id`                 | `uuid`        | primary key, default `uuidv7()`                        |
| `kind`               | `text`        | not null                                               |
| `name`               | `text`        | not null; unique on `(kind, name)`                     |
| `description`        | `text`        | not null; max length is per-Kind, enforced in shared   |
| `body`               | `text`        | null                                                    |
| `payload`            | `jsonb`       | not null — the Kind's own fields                       |
| `published_by`       | `uuid`        | null, references `users(id)` on delete set null         |
| `published_by_email` | `text`        | not null                                               |
| `published_by_name`  | `text`        | not null                                               |
| `published_at`       | `timestamptz` | not null, default `now()`                              |
| `created_at`          | `timestamptz` | not null, default `now()` — set once, on first insert, never touched again |
| `updated_at`          | `timestamptz` | not null, default `now()` — bumped on every republish  |
| `search`             | `tsvector`    | generated always as stored, see below                  |

`id` is the stable identity `GET`, `DELETE`, and the Artifact download route key a Resource by —
generated once, on first insert, and never changes across republishes of the same `(kind, name)`
(the conflict-update path never sets it).

`kind` is plain text, validated in the service against the `KINDS` map in
`@in-org-quicko/skillset-shared` — the same treatment `integrations.provider` gets against
`GIT_PROVIDERS` (ADR-0024) — rather than a Postgres enum, so registering a new Kind is an insert,
not a migration.

`name` stays how a Resource is **published**: flat, no namespacing, no version history, and
still the row's *publishing* identity together with `kind` — `PUT` is an upsert by `(kind,
name)`, since there is no `id` before the row exists (ADR-0002, amended by ADR-0026). Two
Resources of different Kinds may share a name. There is **no check constraint** on `name`: no
single pattern fits every Kind, so validation lives entirely in the shared per-Kind validators
(ADR-0026) — for `skill`, still 1–64 characters, lowercase alphanumerics and hyphens, no leading
or trailing hyphen, no doubled hyphen.

`body` is markdown documentation — a Skill's `SKILL.md` content, supplied by the CLI or the web
interface rather than parsed from the Artifact (the API never reads the Artifact, ADR-0001), or
author-written for a future Kind with no such convention. It is **nullable**: not every Kind
supplies one, though Skill's own shared validation still requires it. Rendered through an
allowlist sanitiser, never trusted as markup.

**`payload`** carries the Kind's own fields, validated by `ResourcePayloadSchema`'s discriminated
union in `@in-org-quicko/skillset-shared` (ADR-0026). For `skill`, this is the four optional Agent Skills
spec fields the table used to carry as flat columns — `license`, `compatibility`, `metadata`, and
`allowed_tools` — each `null` until a publish sets it. A value that fails validation rejects the
whole publish rather than being stored or dropped silently (ADR-0009). Publishing always writes
all four keys into `payload` (a validated value, or `null` when the request doesn't set it), so
republishing a Skill without a field it previously had clears it, the same full-replace semantics
`description` and `body` already have. Postgres enforces nothing about `payload`'s shape — see
ADR-0026's consequences for what that costs and why it's acceptable here.

**Tags** are not a column on this table at all — see `tags` and `resource_tags` below. No publish
path (a fresh publish or a replace of an existing Resource) ever touches them (ADR-0008).

**`created_at`/`updated_at` are generic bookkeeping, distinct from `published_at`.**
Every table carries this pair; on `resources` it currently tracks the same events
`published_at` already does (there is no way to change a Resource's row other than
publishing it), so the two are redundant today — but `created_at` stays fixed across
every republish while `published_at` doesn't, and a future non-publish mutation to this
row would have somewhere generic to record itself without overloading a
publish-specific field.

**Publisher attribution is stored three ways, on purpose.** `published_by` joins to the User for
a current name while that User exists; `published_by_email` is a snapshot taken at publish time
so that attribution survives the User being removed. A foreign key alone cannot do this — the
reference is nulled when the row goes — and removing a User must not erase the record of who
changed a shared Resource. Any writer may replace any Resource, so this is the only accountability
the model has.

`published_by_name` (ticket 23) is a third snapshot, written the same moment `published_by_email`
is: a display name the Resource list and full-text search (below) can use without a live join to
`users`, and one that doesn't change if that User later renames themselves — a republish is what
refreshes it, the same full-replace semantics every other publish-time field has.

The Artifact's storage keys are **derived** from the Resource's `id` rather than stored (ADR-0026;
ticket 2 moved them off `name`, which would otherwise make a future Kind whose name contains a
slash, like an MCP Server, create a nested object path). An Artifact is a **prefix**,
`resources/<id>/`, holding one object per file at the path the Skill's own folder had it at
(ADR-0032) — not one zip. Objects at the old `resources/<id>.zip` were not migrated; those Skills
were re-published.

**Nothing about the Artifact is a column, including the list of files it holds.** Storage is the
source of truth for that: `GET /resources/{id}/files` lists the prefix rather than reading back
the manifest the publisher declared, so a publish whose per-file uploads only partly finished
reports what is actually there. Keeping the manifest in `payload` as well would make a second
copy that a failed upload silently falsifies. There is still no size or digest column either: the
API never sees the uploaded bytes, so it has nothing truthful to record (ADR-0001, as amended by
ADR-0032 for the read path only).

There is no status column and no soft delete. A row exists from the moment publishing starts,
before any of its Artifact has been uploaded — the accepted consequence being that an abandoned
publish leaves a Resource that lists and reads but fails to download until an Admin removes it.
Since an Artifact is now uploaded a file at a time, that abandonment has a partial form too: a
row whose prefix holds some of its files. It reads the same way — the listing shows what arrived,
and the zip download refuses.

The generated column and its index — folding in `published_by_name` (ticket 23) alongside `name`
and `description`, so a search term matching only a Resource's publisher still returns it:

```sql
ALTER TABLE resources ADD COLUMN search tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', name || ' ' || coalesce(description, '') || ' ' || published_by_name)
  ) STORED;

CREATE INDEX resources_search_idx ON resources USING GIN (search);
```

Indexes: primary key on `id`; unique on `(kind, name)`; GIN on `search`; on `updated_at`
descending, for the new default sort (ADR-0028) — there is no equivalent index left on
`published_at`.

## `tags`

The Tag catalog — registry-wide, not scoped to any one Skill (ADR-0011).

| Column       | Type          | Constraints                                     |
| ------------ | ------------- | ------------------------------------------------ |
| `id`         | `uuid`        | primary key, default `uuidv7()`                  |
| `name`       | `text`        | not null, unique                                 |
| `created_at` | `timestamptz` | not null, default `now()`                        |
| `updated_at` | `timestamptz` | not null, default `now()` — bumped on rename      |

`name` is always stored already lowercased and trimmed — the shared `validateTagName`
normalises before this is ever written — so a plain unique index catches a collision without
needing a case-insensitive functional one. A check constraint enforces the same shape a
Skill's `name` has: 1–32 characters, lowercase alphanumerics and hyphens, no leading,
trailing, or doubled hyphen.

A Tag can outlive every Skill that once carried it: detaching the last reference does not
delete the row, and no route deletes a Tag at all today (ADR-0011) — an unused catalog entry
is accepted clutter, not a state the schema tries to prevent.

Indexes: unique on `name`.

## `resource_tags`

The many-to-many join between `resources` and `tags` (ADR-0011). Replaces `skill_tags`.

| Column        | Type          | Constraints                                              |
| ------------- | ------------- | --------------------------------------------------------- |
| `resource_id` | `uuid`        | not null, references `resources(id)` on delete cascade    |
| `tag_id`      | `uuid`        | not null, references `tags(id)` on delete cascade         |
| `created_at`  | `timestamptz` | not null, default `now()`                                 |
| `updated_at`  | `timestamptz` | not null, default `now()`                                 |

Primary key on `(resource_id, tag_id)` — the pair is the row's identity, so a Resource can't
carry the same Tag twice. Both sides cascade: deleting a Resource must not orphan its join rows,
and — although no route deletes a Tag yet — a future one shouldn't have to remember to clean this
table up too.

`created_at`/`updated_at` always agree here in practice: a row is only ever inserted or
deleted, never updated in place (`setSkillTags` deletes and re-inserts on every change
rather than updating a row's `tag_id`), so `updated_at` never has a chance to diverge from
`created_at`. Present anyway, for the same reason every other table carries the pair.

`PUT /resources/{id}/tags` (a full replace) resolves every name in the request to a `tags` row —
reusing an existing one or creating it — then deletes and re-inserts this Resource's rows in one
transaction, so the join always reflects exactly the set just sent, never a partial merge of
old and new.

Indexes: primary key on `(resource_id, tag_id)`; on `tag_id`, for renaming or ever deleting a Tag
without a full scan of this table.

## `resource_install_events`

The Install event log (ADR-0012, ADR-0028, `.scratch/skill-analytics/spec.md`) — one immutable
row per Install, an append-only history rather than a running total. Replaces
`skill_install_events`.

| Column        | Type                  | Constraints                                             |
| ------------- | --------------------- | ---------------------------------------------------------- |
| `id`          | `uuid`                | primary key, default `uuidv7()`                             |
| `resource_id` | `uuid`                | not null, references `resources(id)` on delete cascade      |
| `source`      | `skill_install_source`| not null — `web` or `cli`                                   |
| `created_at`  | `timestamptz`         | not null, default `now()`                                   |

The Postgres enum is still named `skill_install_source` — nothing about "where an Install came
from" is Skill-specific, but renaming the type was out of scope for the ticket that generalised
this table (spec: `.scratch/generic-resources/spec.md`). It has two values: `web` (a Download of
a Kind's Artifact through the API) or `cli` (`skillset add`, ticket 09). Downloading a Skill's
Artifact appends one row here today, via an internal `recordInstall` function (not a public
endpoint — nothing lets a client inflate this directly for a Kind with an Artifact), called once
every file of the Artifact is in hand and the zip has been assembled (ADR-0032) — so a download
that fails part-way never inflates the count. Browsing an Artifact's files, or reading one of
them, records nothing: listing or previewing what a Skill contains is not obtaining it
(ADR-0028). The write is best-effort: a failure is logged and swallowed, never allowed to fail
the download itself.

There is no `updated_at`. Every other table in this schema carries the pair by convention, but a
row here is never touched again after insert — a column that could only ever equal `created_at`
would be a bare column, not genuine consistency with the rest of the schema. Rows are kept
forever: nothing prunes or rolls this table up.

Indexes: primary key on `id`; on `resource_id`, for the aggregation `resource_analytics` runs
below.

## `resource_analytics` (materialized view)

A running install count per Resource, aggregated from `resource_install_events` (ADR-0012,
ADR-0028). Replaces `skill_analytics`.

| Column          | Type      | Constraints |
| --------------- | --------- | ----------- |
| `resource_id`   | `uuid`    | one row per Resource with at least one Install |
| `install_count` | `integer` | `count(*)` of that Resource's rows in `resource_install_events` |

```sql
CREATE MATERIALIZED VIEW resource_analytics AS
  SELECT resource_id, count(*)::integer AS install_count
  FROM resource_install_events
  GROUP BY resource_id;
```

A Resource with no recorded Install has no row here at all — the same "absent means 0" contract
the plain table this view replaced had. Every read path (a Resource's detail read, its
list-summary read) treats "no row" and "a row with `install_count = 0`" identically.

**This view is never read live.** It is recomputed only by `refreshInstallCounts`
(`apps/api/src/features/analytics/analytics.service.ts`) — a plain `REFRESH MATERIALIZED VIEW`, called on every tick
of a schedule (`ANALYTICS_REFRESH_CRON`, a `node-cron` expression, default every 30 seconds) that
is wired up only in `server.ts`, never inside request handling. Every install count shown
anywhere — a Skill's own page, the Skill list, `sort_by=installs` — can therefore lag reality by up
to that interval, including a reader not seeing their own just-completed download reflected
immediately. See ADR-0012 for why this replaced an atomic `install_count + 1` upsert on a live
table. Counts are **not comparable across Kinds** once a second one exists (ADR-0028) — a Skill's
count is a completed byte transfer, a future Kind's may be softer evidence.

## `resource_directory` (view)

The Resource list's read model (ticket 23) — `GET /resources` reads from here, and nowhere else.
One row per Resource, joining `resources` to `resource_analytics` and aggregating its Tags.
Replaces `skill_directory`.

| Column               | Type          | Constraints |
| -------------------- | ------------- | ----------- |
| `id`                 | `uuid`        | |
| `kind`                | `text`        | filtered by `GET /resources?kind=` (ticket 2, ADR-0026) |
| `name`               | `text`        | |
| `description`        | `text`        | |
| `published_by_name`  | `text`        | |
| `updated_at`          | `timestamptz` | |
| `search`             | `tsvector`    | `resources.search`, unchanged |
| `install_count`      | `integer`     | `0` for a Resource with no row in `resource_analytics` |
| `tags`               | `jsonb`       | `{id, name}[]`, `[]` for a Resource with no Tags |

```sql
CREATE VIEW resource_directory AS
  SELECT
    r.id, r.kind, r.name, r.description, r.published_by_name, r.updated_at, r.search,
    COALESCE(ra.install_count, 0) AS install_count,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) ORDER BY t.name)
       FROM resource_tags rt JOIN tags t ON t.id = rt.tag_id
       WHERE rt.resource_id = r.id),
      '[]'::jsonb
    ) AS tags
  FROM resources r
  LEFT JOIN resource_analytics ra ON ra.resource_id = r.id;
```

A plain view, not materialized — unlike `resource_analytics`, everything here is always current
except the install count it inherits, which lags exactly as far as `resource_analytics` does
(ADR-0012). Tag *filtering* (`GET /resources?tag_id=…`, any-match across one or more Tags) is a
membership check against `resource_tags` directly in the query that reads from this view, not a
condition against the `tags` column above — that column is for display, so a filter never has to
express "does this jsonb array contain one of these ids" in SQL. Kind filtering
(`GET /resources?kind=…`) is a plain equality check against `kind` itself; omitted, every Kind is
listed together — with `skill` the only one registered, the filter is exercisable but not yet
load-bearing.

`GET /resources` sorts by `install_count` or `updated_at` (`sort_by`, default `updated_at` since
ADR-0028 — installs are not comparable across Kinds; `sort_order`, default `desc`), governing order
unconditionally — even with a search term (`q`) active, there is no separate relevance ranking.
`page_size` is client-supplied, defaulting to 10 and clamped to [1, 100] rather than rejected; an
invalid `kind`, `sort_by`, or `sort_order` is rejected instead, the same field-named validation
error the rest of the API gives bad input. Ties on the requested sort column (e.g. every Skill with
0 installs) break on `id` ascending, so paging through them with infinite scroll never repeats or
skips a row.

Indexes: none today. `REFRESH MATERIALIZED VIEW CONCURRENTLY` (which would need one) was considered
and deferred — see ADR-0012.

## `identity_providers`

At most one row per kind (ADR-0017). Any number of them may be enabled, and every enabled one
is offered on the login page.

```
id                       uuid primary key default uuidv7()
kind                     identity_provider_kind not null unique  -- 'google' | 'microsoft' | 'github'
display_name             text not null
client_id                text not null
client_secret            text not null
permitted_organisations  text[] not null default '{}'
enabled                  boolean not null default false
created_at               timestamptz not null default now()
updated_at               timestamptz not null default now()
```

`kind` is the Provider's identity, which is why it is unique and why no route changes it.
There is no slug and no issuer URL: Better Auth knows each kind's endpoints (ADR-0016), so an
Admin configures the credential pair and the organisations to admit, and nothing about the
protocol.

`permitted_organisations` holds Workspace domains (Google's `hd` claim), tenant ids (Entra's
`tid`), or GitHub organisation logins. A login is admitted if what the Provider asserts matches
**any one** of them — a claim for the first two, a live `/user/orgs` check for GitHub, which issues
no ID token (ADR-0018) — and never against the email address's suffix. Comparison is
case-insensitive; the stored spelling is whatever the Admin typed.

An **empty array is a configuration, not a blank**: no organisation check runs, and every account
the provider authenticates gets a `reader` here (ADR-0021). Because a login provisions a User just
in time, this column is the only control on who gets an account, so emptying it opens the Registry
to everyone that provider will authenticate — for GitHub, the whole internet. A check constraint
once made this state unreachable for an enabled Provider; ADR-0021 drops it deliberately, and the
interface, the service, and every individual login log a warning in its place.

`client_secret` is stored as given, following listmonk (ADR-0015). No response shape includes
it — it is written and never read back, so a leaked backup is the only way it escapes.

There is deliberately **no** `user_identities` table. A login is matched to a User by the
email the provider asserts and creates one if none matches, so the `users` row is
the identity and a person signing in through two Providers is one row, not two links. ADR-0015
reverses ADR-0007 on this point and records what it costs: a rename in the provider creates a
second User rather than following the first.

Deleting a Provider is not a supported operation — `enabled` is how one is taken out of
service, so nobody loses their way in to a mistyped click.

## `integrations`

The Registry's registration with a Git Provider, holding the credential pair a Connection is
granted against (ADR-0024). More than one row may exist for the same provider — two different
GitHub Apps, say, for two different orgs or environments — so `id` rather than `provider` is a
row's identity (ADR-0025, superseding ADR-0024's "one row per provider").

```
id             uuid primary key default uuidv7()
provider       text not null                    -- 'github' | 'gitlab'; not unique
display_name   text not null
client_id      text not null
client_secret  text not null
app_slug       text                             -- null for a provider with no installation step
created_at     timestamptz not null default now()
updated_at     timestamptz not null default now()
```

**This is not a column on `identity_providers`, and the separation is the point.** GitHub is
reached through two registrations that share nothing but a vendor: an OAuth App for signing in,
which lives in `identity_providers`, and a GitHub App for Importing, which lives here. Either may
exist without the other. Signing in with GitHub while holding no repository credential is a
supported deployment, and so is Importing from GitHub on a Registry where nobody can sign in with
it.

`provider` is **plain text, not an enum**, so registering a new Git Provider is an insert rather
than a migration (ADR-0024). The values it may take are the keys of `GIT_PROVIDERS` in
`@in-org-quicko/skillset-shared`, checked in the service. Since ADR-0025, `provider` carries no uniqueness
constraint and no incoming foreign key: `connections.integration_id` references this table's `id`
instead, recording which specific app a grant was issued through, while `connections.provider`
stays denormalized for the provider-keyed read paths that never needed to change.

**A row's existence is the only switch Importing has.** There is deliberately no
`import_enabled` flag: an operator who wants this Registry to hold no repository credentials for
anybody creates no row, and that is the off switch. A second switch above it would express nothing
the first does not. ADR-0024 records why the Admin-level flag ADR-0023 proposed was dropped.

`app_slug` is the app's slug at the provider, used to build its installation URL
(`https://github.com/apps/{app_slug}/installations/new`). It is nullable because only GitHub has an
installation step; GitLab has none.

`client_secret` is stored as given, following `identity_providers` and listmonk (ADR-0015). No
response shape includes it — it is written and never read back. Note honestly what that means
alongside the encrypted Connection tokens that reference this row: encryption there defends a
leaked backup, not a compromised host, because this secret sits beside it in plaintext.

There is no delete route, matching `/identity-providers`. Removing an Integration that writers
still hold Connections against would strand those credentials, and the `ON DELETE RESTRICT` on
`connections.integration_id` refuses it at the database. Repointing an Integration's `client_id` in
place (`PATCH /integrations/:id`) clears only the Connections made through *that* Integration, not
every Connection for its provider — a sibling app's Connections are unaffected by this one's
credentials changing (ADR-0025).

## `connections`

A writer's own grant of repository access to the Registry, made deliberately and separately from
signing in (ADR-0024). Its existence *is* the consent; nothing else records it.

```
id                        uuid primary key default uuidv7()
user_id                   uuid not null references users(id) on delete cascade
provider                  text not null                     -- denormalized from integrations, not a FK
integration_id            uuid not null references integrations(id) on delete restrict
external_account_id       text not null
external_account_login    text not null
access_token              text not null                      -- ciphertext
refresh_token             text                               -- ciphertext, null when none was issued
expires_at                timestamptz                        -- null means the token does not expire
refresh_token_expires_at  timestamptz
created_at                timestamptz not null default now()
updated_at                timestamptz not null default now()
unique (user_id, provider)
```

**This is deliberately not an `accounts` row.** Better Auth's `accounts` table models identities,
and a Connection is not one: nobody signs in by connecting, the connected account need not be the
account the writer signs in with, and the Permitted Organisation gate does not run on it. Storing a
third-party API credential in the authentication table is the conflation ADR-0024 exists to undo,
and it is also why Better Auth does not drive the grant — the flow is two routes of the Registry's
own with a signed, single-use state.

`integration_id` references `integrations` rather than `provider` carrying a free string
(ADR-0025) — a writer's grant was issued through one specific app, and more than one app can now
exist per provider. That is what makes *"you cannot connect through an app this Registry has not
registered"* a database invariant. `ON DELETE RESTRICT` is load-bearing: removing an Integration
that writers still hold Connections against fails loudly rather than silently dropping their
credentials. `provider` stays alongside it, denormalized, so every provider-keyed read path
(`accessTokenFor`, disconnect, imports) is unaffected by which specific app a Connection went
through.

`unique (user_id, provider)` means reconnecting **replaces**. One Connection per writer per
provider, so "which account does this Import use?" never needs asking — the alternative is a picker
on a paste-a-URL flow, or trying each account in turn, which turns one 404 into several.

`external_account_id` is the provider's own id, which survives a rename where the login does not.
`external_account_login` exists for the interface: a writer needs to see *which* account is
connected, because it need not be the one they sign in with, and that is usually the answer to "why
can this Import not see my repository?".

Both token columns hold **ciphertext**, AES-256-GCM under Better Auth's signing secret. State the
limit of that honestly: it defends a leaked *backup*, not a compromised host, because
`integrations.client_secret` sits in plaintext in the same database by ADR-0015's deliberate
choice, and anyone who can read the environment can decrypt.

`expires_at` and `refresh_token` are **nullable, and null is meaningful**: it says the provider
issued a token that does not expire. ADR-0024 keeps GitHub App token expiry switched on, but an
operator can switch it off on their own app, and connecting must not fail because they did. A token
within a minute of expiry is refreshed before use — before it expires, not after, because a token
that dies part-way through a folder walk is a failure a refresh thirty seconds earlier would have
avoided, and the walk is not resumable.

There is no delete route for an Integration, so a Connection is only ever removed by its writer
disconnecting, by their role dropping below `writer`, or by their User row going away. Note that
disconnecting is **Registry-local**: it stops this Registry using the grant and does not withdraw
it at the provider. If the interface ever says "revoked" without that qualification, the product
and ADR-0024 disagree, and the ADR is right.

## `sessions`, `accounts`, and `verifications`

These three belong to Better Auth (ADR-0016). Their columns are its model, mapped back to this
repo's snake_case in `apps/api/src/features/auth/instance.ts` rather than letting one library's naming
break the convention that a column, its TS key, and the wire all agree. Nothing in this
codebase writes to them directly.

`sessions` replaces the stateless JWT ADR-0005 described. A session is a row keyed by a unique
`token`, with a `user_id` that cascades on delete — so logging out genuinely revokes, and the
trade-off ADR-0005 accepted ("a session cannot be revoked before its JWT expires") is no longer
paid. What has *not* changed is the half that mattered: the session says who you are and never
what you may do, so the role is still resolved from `users` on every request.

`accounts` holds one row per way a User can authenticate. `provider_id` is `credential` for a
password — that row's `password` column is where `users.password_hash` went — or the Provider's
kind for an external login. `issuer` says who vouched for it: the provider's own issuer, or the
synthetic `local:credential` for a password.

`access_token` on a **`github`** row is always null, and that is enforced rather than merely
expected. It used to hold a live credential carrying the `repo` scope — read *and* write across
every private repository that User could reach — because a login doubled as the credential for
importing (ADR-0020). ADR-0024 ends that: repository access comes from a **Connection** granted
against a separate GitHub App, so nothing reads this column for GitHub any more.

Three things keep it null, and all three are needed:

- `GITHUB_SCOPES` no longer asks for `repo`.
- A database hook in `createAuth` nulls the token fields on any `github` account write, create
  and update alike. Unrequesting the scope is not sufficient on its own: scopes **accumulate** on
  a GitHub OAuth App, so anyone who once granted `repo` keeps being issued a `repo`-capable token
  whatever the Registry asks for.
- Migration `0005_forget_github_login_tokens` cleared the rows written before all this.

The hook has a sharp edge worth knowing about, recorded on `withoutGitHubTokens` and covered by
`apps/api/test/github-login-tokens.test.ts`: Better Auth *merges* what a `before` hook returns
over the data it already had, so omitting a field restores it. Only an explicit null survives. A
hook written to delete the keys reads as correct and stores the token anyway.

`scope` on those same rows is **left alone**, and still reads `repo` for anyone who granted it.
That is deliberate and it is not a contradiction: `scope` records what GitHub actually granted,
and GitHub has still granted `repo` — scopes accumulate on an OAuth App, so the grant outlives
the Registry's decision to stop asking for it or storing its token. Clearing the column would
make the row *less* truthful, and would erase the only record of which Users have a `repo` grant
sitting at GitHub for them to revoke. So: a `github` row with a null `access_token` and a `scope`
mentioning `repo` is the expected and correct state, not a half-finished migration.

What this does **not** do, and must not be described as doing: it does not withdraw the `repo`
grants people already gave at GitHub. Those live in each person's own GitHub authorizations, and
revoking them from here would take `DELETE /applications/{client_id}/grant`, which withdraws the
whole authorization and would face every existing user with a fresh consent screen at their next
sign-in. Deleting our copy is a real mitigation and a partial one.

Google and Microsoft tokens are untouched and still stored here, encrypted at rest — Better
Auth's `encryptOAuthTokens` is on, so the column holds AES-256-GCM ciphertext under
`BETTER_AUTH_SECRET` and anything reading it has to decrypt first. Treat the column as the most
sensitive in the schema regardless: password and Token hashes are one-way, and this one is
reversible by design.

The three of `provider_id`, `issuer`, and `account_id` are unique together because they are what
Better Auth matches an account on, all three at once. Writing a credential without the issuer
does not fail — it produces a row that sign-in cannot see, so the login is refused as though the
User did not exist. `apps/api/test/auth-schema.test.ts` checks the mapping for this reason, and
needs no database to do it.

`verifications` is Better Auth's short-lived key/value store. Here it holds the in-flight OAuth
state — the PKCE code verifier and the CSRF nonce — which is why a login begun against one
Better Auth instance survives that instance being rebuilt (ADR-0019).

Token authentication is untouched, and still revokes the moment a Token is deleted.

## Rules the schema cannot express

These are enforced in the application and each needs a test, because the database will not
catch them:

- **The Superadmin's role is permanent.** No route may ever set `role` to `superadmin` for
  anyone other than the User `/setup` created, change it away from `superadmin`, or remove
  that User. The partial unique index stops two Users holding it at once; it does not stop
  either of those.
- **The `/setup` route is unavailable once any User exists**, and the User it creates is the
  Superadmin. Phrase the test that way rather than as "only the Superadmin can create Users":
  a login through an Identity Provider is a third way for a User to come into existence, so
  the other phrasing is false (ADR-0015).
- **An external login never grants a role above `reader`.** A created User is always a
  `reader` — the Provider row carries no role column for a misconfiguration to set — and
  logging in never alters the role of a User who already exists.
- **A Provider's `kind` never changes.** It is the Provider's identity (ADR-0017), so changing
  it would repoint a live configuration rather than configure a second one. The update route
  does not accept it.
- **The organisation gate runs on every login, not only the first.** Someone removed from the
  permitted organisation is refused the next time they sign in, rather than keeping an account
  because they passed the check once (ADR-0018).
- **A Provider is never deleted.** There is no delete route to call; `enabled` is the only way
  one leaves service.
- **Role permissions** — readers cannot publish, writers cannot delete a Skill or manage
  Users.
- **Write ordering.** The row is created before the Artifact is uploaded, and the Skill list
  is refreshed only once every file's upload completes. A republish deletes the files its new
  manifest no longer names *before* handing back upload URLs, so a dropped file is never left
  servable (ADR-0032).
