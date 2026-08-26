# Data Model

Postgres 18. Eight tables, one materialized view, and one plain view. Managed with Drizzle
migrations; the generated search column and both views are declared in hand-written SQL because
Drizzle has no native generator for any of them (ADR-0012).

Terms are as defined in [CONTEXT.md](../CONTEXT.md) — User, Admin, Skill, Artifact, Token, Tag.

Column names are snake_case, and so are the JSON keys in [openapi.json](./openapi.json) and every
TypeScript type — there is no separate camelCase domain shape or conversion boundary. Types are
`z.infer`red from the Zod schemas in `@skill-registry/shared`, so a Drizzle row, a wire payload,
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
| `password_hash`        | `text`        | **null** — absent for externally authenticated Users |
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

`password_hash` holds an argon2id hash from the runtime's built-in hashing; plaintext is
never stored. It is **nullable** because a User who authenticates through an identity
provider has no password at all (ADR-0007). A row in this table means a User exists, not
that a password exists — every path that reads one must tolerate its absence.

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

## `skills`

A Skill in the Registry. One row per Skill, one Artifact per row.

| Column               | Type          | Constraints                                            |
| -------------------- | ------------- | ------------------------------------------------------ |
| `id`                 | `uuid`        | primary key, default `uuidv7()`                        |
| `name`               | `text`        | not null, unique                                       |
| `description`        | `text`        | not null, length ≤ 1024                                |
| `body`               | `text`        | not null                                               |
| `license`            | `text`        | null                                                    |
| `compatibility`      | `text`        | null, length ≤ 500                                     |
| `metadata`           | `jsonb`       | null — a mapping of string keys to string values       |
| `allowed_tools`      | `text`        | null                                                    |
| `published_by`       | `uuid`        | null, references `users(id)` on delete set null         |
| `published_by_email` | `text`        | not null                                               |
| `published_by_name`  | `text`        | not null                                               |
| `published_at`       | `timestamptz` | not null, default `now()`                              |
| `created_at`          | `timestamptz` | not null, default `now()` — set once, on first insert, never touched again |
| `updated_at`          | `timestamptz` | not null, default `now()` — bumped on every republish  |
| `search`             | `tsvector`    | generated always as stored, see below                  |

`id` is the stable identity `GET`, `DELETE`, and the Artifact download route key a Skill by —
generated once, on first insert, and never changes across republishes of the same name
(the conflict-update path never sets it). `name` stays how a Skill is **published**: flat, no
namespacing, no version history, and still the row's sole *publishing* identity — `PUT` is an
upsert by name, since there is no `id` before the row exists, and it is still how the Artifact
is keyed in storage (ADR-0002). A check constraint enforces the same rule the shared validation
module does: 1–64 characters, lowercase alphanumerics and hyphens, no leading or trailing
hyphen, no doubled hyphen.

`body` is the `SKILL.md` content, supplied by the CLI or the web interface rather than parsed
from the Artifact — the API never reads the Artifact (ADR-0001). It is rendered through an
allowlist sanitiser, never trusted as markup.

**`license`, `compatibility`, `metadata`, and `allowed_tools`** are the four optional fields
the Agent Skills specification defines beyond `name` and `description`. Each is `null` until
a publish sets it, validated by the same shared rules as `name` and `description` — a value
that fails validation rejects the whole publish rather than being stored or dropped silently
(ADR-0009). Publishing always writes all four (a validated value, or `null` when the payload
doesn't set it), so republishing a Skill without a field it previously had clears it, the same
full-replace semantics `description` and `body` already have.

**Tags** are not a column on this table at all — see `tags` and `skill_tags` below. No publish
path (a fresh publish or a replace of an existing Skill) ever touches them (ADR-0008).

**`created_at`/`updated_at` are generic bookkeeping, distinct from `published_at`.**
Every table carries this pair; on `skills` it currently tracks the same events
`published_at` already does (there is no way to change a Skill's row other than
publishing it), so the two are redundant today — but `created_at` stays fixed across
every republish while `published_at` doesn't, and a future non-publish mutation to this
row would have somewhere generic to record itself without overloading a
publish-specific field.

**Publisher attribution is stored three ways, on purpose.** `published_by` joins to the User for
a current name while that User exists; `published_by_email` is a snapshot taken at publish time
so that attribution survives the User being removed. A foreign key alone cannot do this — the
reference is nulled when the row goes — and removing a User must not erase the record of who
changed a shared Skill. Any writer may replace any Skill, so this is the only accountability
the model has.

`published_by_name` (ticket 23) is a third snapshot, written the same moment `published_by_email`
is: a display name the Skill list and full-text search (below) can use without a live join to
`users`, and one that doesn't change if that User later renames themselves — a republish is what
refreshes it, the same full-replace semantics every other publish-time field has. Existing Skills
were backfilled once, from the User each currently referenced (or, for a Skill whose publisher was
already removed by then, its `published_by_email`) — see the migration adding this column.

The Artifact's storage key is **derived** from the name rather than stored. There is no size
or digest column: the API never sees the bytes, so it has nothing truthful to record.

There is no status column and no soft delete. A row exists from the moment publishing starts,
before its Artifact has been uploaded — the accepted consequence being that an abandoned
publish leaves a Skill that lists and reads but fails to download until an Admin removes it.

The generated column and its index — folding in `published_by_name` (ticket 23) alongside `name`
and `description`, so a search term matching only a Skill's publisher still returns it:

```sql
ALTER TABLE skills ADD COLUMN search tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', name || ' ' || coalesce(description, '') || ' ' || published_by_name)
  ) STORED;

CREATE INDEX skills_search_idx ON skills USING GIN (search);
```

Indexes: primary key on `id`; unique on `name`; GIN on `search`; on `published_at` descending,
for the most-recent-first listing.

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

## `skill_tags`

The many-to-many join between `skills` and `tags` (ADR-0011).

| Column       | Type          | Constraints                                          |
| ------------ | ------------- | ----------------------------------------------------- |
| `skill_id`   | `uuid`        | not null, references `skills(id)` on delete cascade   |
| `tag_id`     | `uuid`        | not null, references `tags(id)` on delete cascade     |
| `created_at` | `timestamptz` | not null, default `now()`                             |
| `updated_at` | `timestamptz` | not null, default `now()`                             |

Primary key on `(skill_id, tag_id)` — the pair is the row's identity, so a Skill can't carry
the same Tag twice. Both sides cascade: deleting a Skill must not orphan its join rows, and —
although no route deletes a Tag yet — a future one shouldn't have to remember to clean this
table up too.

`created_at`/`updated_at` always agree here in practice: a row is only ever inserted or
deleted, never updated in place (`setSkillTags` deletes and re-inserts on every change
rather than updating a row's `tag_id`), so `updated_at` never has a chance to diverge from
`created_at`. Present anyway, for the same reason every other table carries the pair.

`PUT /skills/{id}/tags` (a full replace) resolves every name in the request to a `tags` row —
reusing an existing one or creating it — then deletes and re-inserts this Skill's rows in one
transaction, so the join always reflects exactly the set just sent, never a partial merge of
old and new.

Indexes: primary key on `(skill_id, tag_id)`; on `tag_id`, for renaming or ever deleting a Tag
without a full scan of this table.

## `skill_install_events`

The Install event log (ADR-0012, `.scratch/skill-analytics/spec.md`) — one immutable row per
Install, an append-only history rather than a running total.

| Column       | Type                  | Constraints                                          |
| ------------ | --------------------- | ----------------------------------------------------- |
| `id`         | `uuid`                | primary key, default `uuidv7()`                        |
| `skill_id`   | `uuid`                | not null, references `skills(id)` on delete cascade    |
| `source`     | `skill_install_source`| not null — `web` or `cli`                              |
| `created_at` | `timestamptz`         | not null, default `now()`                              |

`skill_install_source` is an enum: `web` (a Skill's Artifact downloaded through the API) or `cli`
(`skillreg add`, ticket 09 — not built yet, but the column already distinguishes it once it is).
Downloading a Skill's Artifact appends one row here today, via an internal `recordInstall`
function (not a public endpoint — nothing lets a client inflate this directly), called once the
Artifact is confirmed to exist and right before the presigned download URL is issued. The write is
best-effort: a failure is logged and swallowed, never allowed to fail the download itself.

There is no `updated_at`. Every other table in this schema carries the pair by convention, but a
row here is never touched again after insert — a column that could only ever equal `created_at`
would be a bare column, not genuine consistency with the rest of the schema. Rows are kept
forever: nothing prunes or rolls this table up.

Indexes: primary key on `id`; on `skill_id`, for the aggregation `skill_analytics` runs below.

## `skill_analytics` (materialized view)

A running install count per Skill, aggregated from `skill_install_events` (ADR-0012).

| Column          | Type      | Constraints |
| --------------- | --------- | ----------- |
| `skill_id`      | `uuid`    | one row per Skill with at least one Install |
| `install_count` | `integer` | `count(*)` of that Skill's rows in `skill_install_events` |

```sql
CREATE MATERIALIZED VIEW skill_analytics AS
  SELECT skill_id, count(*)::integer AS install_count
  FROM skill_install_events
  GROUP BY skill_id;
```

A Skill with no recorded Install has no row here at all — the same "absent means 0" contract the
plain table this view replaced had. Every read path (a Skill's detail read, its list-summary read)
treats "no row" and "a row with `install_count = 0`" identically.

**This view is never read live.** It is recomputed only by `refreshInstallCounts`
(`apps/api/src/services/analytics.ts`) — a plain `REFRESH MATERIALIZED VIEW`, called on every tick
of a schedule (`ANALYTICS_REFRESH_CRON`, a `node-cron` expression, default every 30 seconds) that
is wired up only in `server.ts`, never inside request handling. Every install count shown
anywhere — a Skill's own page, the Skill list, `sort_by=installs` — can therefore lag reality by up
to that interval, including a reader not seeing their own just-completed download reflected
immediately. See ADR-0012 for why this replaced an atomic `install_count + 1` upsert on a live
table.

## `skill_directory` (view)

The Skill list's read model (ticket 23) — `GET /skills` reads from here, and nowhere else. One row
per Skill, joining `skills` to `skill_analytics` and aggregating its Tags.

| Column               | Type          | Constraints |
| -------------------- | ------------- | ----------- |
| `id`                 | `uuid`        | |
| `name`               | `text`        | |
| `description`        | `text`        | |
| `published_by_name`  | `text`        | |
| `updated_at`          | `timestamptz` | |
| `search`             | `tsvector`    | `skills.search`, unchanged |
| `install_count`      | `integer`     | `0` for a Skill with no row in `skill_analytics` |
| `tags`               | `jsonb`       | `{id, name}[]`, `[]` for a Skill with no Tags |

```sql
CREATE VIEW skill_directory AS
  SELECT
    s.id, s.name, s.description, s.published_by_name, s.updated_at, s.search,
    COALESCE(sa.install_count, 0) AS install_count,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) ORDER BY t.name)
       FROM skill_tags st JOIN tags t ON t.id = st.tag_id
       WHERE st.skill_id = s.id),
      '[]'::jsonb
    ) AS tags
  FROM skills s
  LEFT JOIN skill_analytics sa ON sa.skill_id = s.id;
```

A plain view, not materialized — unlike `skill_analytics`, everything here is always current
except the install count it inherits, which lags exactly as far as `skill_analytics` does
(ADR-0012). Tag *filtering* (`GET /skills?tag_id=…`, any-match across one or more Tags) is a
membership check against `skill_tags` directly in the query that reads from this view, not a
condition against the `tags` column above — that column is for display, so a filter never has to
express "does this jsonb array contain one of these ids" in SQL.

`GET /skills` sorts by `install_count` or `updated_at` (`sort_by`, default `installs`; `sort_order`,
default `desc`), governing order unconditionally — even with a search term (`q`) active, there is
no separate relevance ranking. `page_size` is client-supplied, defaulting to 10 and clamped to
[1, 100] rather than rejected; an invalid `sort_by` or `sort_order` is rejected instead, the same
field-named validation error the rest of the API gives bad input. Ties on the requested sort column
(e.g. every Skill with 0 installs) break on `id` ascending, so paging through them with infinite
scroll never repeats or skips a row.

Indexes: none today. `REFRESH MATERIALIZED VIEW CONCURRENTLY` (which would need one) was considered
and deferred — see ADR-0012.

## Not built yet: `user_identities`

OIDC is not implemented, and no table for it exists. When it arrives — Google Workspace first —
it will be a `user_identities` table holding the User, the provider, and the provider's `subject`
claim, unique on provider and subject.

It is keyed by subject rather than email on purpose: Workspace emails are mutable, so matching a
login on email means an admin renaming someone silently orphans their account, their Tokens, and
the attribution on every Skill they published. Email remains the identifier a human uses and the
key an external identity is *linked* by the first time; `subject` is what every login after that
matches on. See ADR-0007 for what is deferred to that point.

## No sessions table

Web sessions are a signed token in a cookie carrying only the User's id (ADR-0005). Nothing
is persisted, so there is no table to look for and no session to revoke — only expiry. Token
authentication is the path that *is* revocable.

## Rules the schema cannot express

These are enforced in the application and each needs a test, because the database will not
catch them:

- **The Superadmin's role is permanent.** No route may ever set `role` to `superadmin` for
  anyone other than the User `/setup` created, change it away from `superadmin`, or remove
  that User. The partial unique index stops two Users holding it at once; it does not stop
  either of those.
- **The `/setup` route is unavailable once any User exists**, and the User it creates is the
  Superadmin. Phrase the test that way rather than as "only the Superadmin can create Users" —
  OIDC will add a third way for a User to come into existence (ADR-0007).
- **Role permissions** — readers cannot publish, writers cannot delete a Skill or manage
  Users.
- **Write ordering.** The row is created before the Artifact is uploaded, and the Skill list
  is refreshed only once the upload completes.
