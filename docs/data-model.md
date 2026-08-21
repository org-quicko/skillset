# Data Model

Postgres 18. Three tables. Managed with Drizzle migrations; the generated search column is
declared in hand-written SQL because Drizzle has no native `tsvector`.

Terms are as defined in [CONTEXT.md](../CONTEXT.md) — User, Admin, Skill, Artifact, Token.

Column names are snake_case, and so are the JSON keys in [openapi.json](./openapi.json) — the two
line up deliberately. TypeScript is camelCase, and the single conversion between the two lives in
the shared module at the API boundary. A column name appearing in a wire payload is therefore
expected, not a leak.

## `users`

A User of the Registry.

| Column                 | Type          | Constraints                                       |
| ---------------------- | ------------- | ------------------------------------------------- |
| `id`                   | `uuid`        | primary key, default generated                    |
| `email`                | `text`        | not null, unique                                  |
| `first_name`           | `text`        | not null                                          |
| `last_name`            | `text`        | not null                                          |
| `password_hash`        | `text`        | **null** — absent for externally authenticated Users |
| `role`                 | `user_role`   | not null                                          |
| `must_change_password` | `boolean`     | not null, default `false`                         |
| `created_at`           | `timestamptz` | not null, default `now()`                         |
| `updated_at`           | `timestamptz` | not null, default `now()`                         |

`user_role` is an enum: `reader`, `writer`, `admin`.

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
| `id`           | `uuid`        | primary key, default generated                       |
| `user_id`      | `uuid`        | not null, references `users(id)` on delete cascade   |
| `name`         | `text`        | not null                                             |
| `token_hash`   | `text`        | not null, unique — SHA-256 hex, see below            |
| `created_at`   | `timestamptz` | not null, default `now()`                            |
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
| `name`               | `text`        | primary key                                            |
| `description`        | `text`        | not null, length ≤ 1024                                |
| `body`               | `text`        | not null                                               |
| `published_by`       | `uuid`        | null, references `users(id)` on delete set null         |
| `published_by_email` | `text`        | not null                                               |
| `published_at`       | `timestamptz` | not null, default `now()`                              |
| `search`             | `tsvector`    | generated always as stored, see below                  |

`name` is the sole identity — flat, no namespacing, no version history. Publishing replaces
the row and the Artifact (ADR-0002). A check constraint enforces the same rule the shared
validation module does: 1–64 characters, lowercase alphanumerics and hyphens, no leading or
trailing hyphen, no doubled hyphen.

`body` is the `SKILL.md` content, supplied by the CLI or the web interface rather than parsed
from the Artifact — the API never reads the Artifact (ADR-0001). It is rendered through an
allowlist sanitiser, never trusted as markup.

**Publisher attribution is stored twice, on purpose.** `published_by` joins to the User for a
current name while that User exists; `published_by_email` is a snapshot taken at publish time
so that attribution survives the User being removed. A foreign key alone cannot do this — the
reference is nulled when the row goes — and removing a User must not erase the record of who
changed a shared Skill. Any writer may replace any Skill, so this is the only accountability
the model has.

The Artifact's storage key is **derived** from the name rather than stored. There is no size
or digest column: the API never sees the bytes, so it has nothing truthful to record.

There is no status column and no soft delete. A row exists from the moment publishing starts,
before its Artifact has been uploaded — the accepted consequence being that an abandoned
publish leaves a Skill that lists and reads but fails to download until an Admin removes it.

The generated column and its index:

```sql
ALTER TABLE skills ADD COLUMN search tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', name || ' ' || coalesce(description, ''))
  ) STORED;

CREATE INDEX skills_search_idx ON skills USING GIN (search);
```

Indexes: primary key on `name`; GIN on `search`; on `published_at` descending, for the
most-recent-first listing.

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

- **The last Admin cannot be demoted or removed.** Requires counting Admins within the
  transaction; no constraint can express it.
- **The initialisation route is unavailable once any User exists**, and the User it creates is an
  Admin. Phrase the test that way rather than as "only an Admin can create Users" — OIDC will add a
  third way for a User to come into existence (ADR-0007).
- **Role permissions** — readers cannot publish, writers cannot delete a Skill or manage
  Users.
- **Write ordering.** The row is created before the Artifact is uploaded, and the Skill list
  is refreshed only once the upload completes.
