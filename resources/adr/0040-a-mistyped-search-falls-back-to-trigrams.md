# A Mistyped Search Falls Back to Trigrams

`GET /resources` runs a search term through full-text matching first, exactly as before. Only
when that matches **nothing at all** does it run a second query, matching trigrams against
`name` and `description` with `word_similarity`, so `angulr` still finds
`building-angular-applications`. This needs the `pg_trgm` extension, added in migration
`0003_trigram_search.sql`.

> **Amends ADR-0039**, which deferred exactly this and gave the shape it should take: "a
> fallback that runs only when the full-text query returns no rows". That is what was built.

Full-text search stems but does not forgive. One dropped letter and the term tokenises to a
lexeme that is in no document, so the answer is zero results rather than a near miss — and a
reader has no way to tell "nothing like this exists" from "you typed it wrong".

## Why the fallback is all-or-nothing

It runs only when the exact search found zero rows, and when it runs it replaces that result
rather than padding it. A term that matched something keeps its precise answer, and the
second query is never issued.

Blending the two was the alternative and is worse in both directions: a precise search gets
diluted with near-misses ranked against an incomparable scale, and every query pays for the
trigram scan whether or not it needed one. Zero results is an unambiguous signal that there
is nothing to dilute.

## Why `word_similarity`, and why 0.4

`similarity()` compares whole strings, so `similarity('angulr', 'building-angular-applications')`
scores near zero — the target is five times longer and most of it is unrelated.
`word_similarity()` scores the term against the best-matching extent *within* the target,
which is the question being asked.

The threshold is 0.4, tuned against real misspellings rather than derived. pg_trgm's own
default of 0.6 misses `angulr` (about 0.57 against that Skill's name), which is precisely the
single-dropped-letter case this exists for. Much below 0.4 and unrelated words sharing a stem
start matching.

Name and description only. The body is in the full-text vector but not here: trigram-scanning
kilobytes of prose per row is expensive, and a typo's nearest match is overwhelmingly a
Skill's name.

## Considered Options

**pg_trgm's `<%` operator with a GIN index**, which is the indexable form. Rejected for now:
`<%` reads its threshold from `pg_trgm.word_similarity_threshold`, a session GUC, so getting
0.4 means a `SET LOCAL` and therefore a transaction wrapped around a read path. Comparing
`word_similarity(...) >= 0.4` explicitly needs neither, at the cost of a sequential scan.

That cost is accepted deliberately, not overlooked. The scan happens only when the indexed
search already returned nothing, over a catalog one team publishes. A Registry where it shows
up in practice wants the operator, the GUC and a `gin_trgm_ops` index together — and adding
an index now, without the operator, would be dead weight that nothing plans to use.

**A spelling dictionary** (`pg_trgm`'s `word_similarity` against a lexeme list, or an
`ispell` configuration). More accurate for real words, and useless for the terms that actually
get mistyped here, which are Skill names, product names and identifiers.

**Correcting on the client.** Rejected: the vocabulary worth correcting against is the
catalog, which only the server has.

## Consequences

**A deployment needs `pg_trgm`.** The migration is `CREATE EXTENSION IF NOT EXISTS`, which on
most managed Postgres requires a privileged role. `IF NOT EXISTS` is the escape hatch: a DBA
pre-creates the extension once and the migration becomes a no-op. Documented in the README
under "Fuzzy search", because an operator whose role cannot create it will otherwise meet this
as a failed startup.

**The extension is not schema-qualified**, unlike everything else in these migrations. It
installs into the first schema on the search_path — `public`, since this app sets none
(ADR-0036) — and `public` stays on the search_path whatever `DB_SCHEMA` names, so
`word_similarity()` resolves unqualified from any schema. Installing it into `DB_SCHEMA`
instead would hide it from exactly the deployments that variable exists for.

**A search can now issue two queries instead of one.** Only ever on the zero-result path, so
the common case is unchanged, but a Registry seeing many no-match searches pays for both.

**`sort_by=relevance` means something different on each path** — `ts_rank_cd` for the exact
one, `word_similarity` for the fuzzy one. Both order best-first and neither number is
returned to the caller, so the difference is not observable; it is a reason not to start
exposing a score.

**The MCP server and the web get this for free**, since both go through `GET /resources` and
neither sends anything that opts out.
