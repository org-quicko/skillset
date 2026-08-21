# Postgres Over SQLite

Search over Skills is full-text rather than substring matching, and that is what decides the
engine. In Postgres the index is one declaration — a `tsvector` column
`GENERATED ALWAYS AS (to_tsvector('english', name || ' ' || coalesce(description, ''))) STORED`
with a GIN index — and the database keeps it current. SQLite's FTS5 lives in a separate
virtual table that does not track the source table, so it needs insert/update/delete triggers,
and any write path that misses one leaves search silently stale.

## Consequences

An operator runs Postgres 18 alongside the app. The `docker compose` file ships it, so this is
not extra work for a self-hoster.

Drizzle has no native `tsvector`, so it needs a `customType` and the generated column goes in a
raw migration.

Full-text stemming does not substring-match: `postgres` will not find `postgresql`, and
hyphenated identifiers tokenise per word. `pg_trgm` complements `tsvector` if that becomes a
problem. Exact-name lookup deliberately bypasses search entirely and hits the primary key.
