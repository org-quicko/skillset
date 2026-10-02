# Search Ranks by Relevance, Over a Vector That Includes the Body

`resources.search` now weights its four inputs — name `A`, description `B`, `body` `C`,
publisher `D` — and `GET /resources` gains `sort_by=relevance`, ranked with `ts_rank_cd`.
Relevance is the default whenever `q` is set; `updated_at` remains the default when it is not.

Two things were wrong before, and they compounded. The vector covered name, description and
publisher only, so a Skill was findable by how it had been summarised and never by what it
actually said — every `references/` file and every paragraph of its `SKILL.md` was invisible
to search. And ordering was governed by `sort_by` unconditionally, which with no relevance
option meant a search returned its matches **in date order**. The best match for a term
routinely sat below a recently-republished Skill that merely mentioned it.

## Why weights, and why `ts_rank_cd`

Including `body` without weighting would have made it worse, not better: a Skill mentioning
"changelog" once in a footnote would rank level with the one named `changelog-writer`.
Postgres's default weight array `{D,C,B,A} = {0.1, 0.2, 0.4, 1.0}` already encodes the order
wanted, so the vector is built to match it and no caller passes an array of its own.

`ts_rank_cd` over `ts_rank` because cover density accounts for how close the matched lexemes
sit to each other, which is what separates a Skill about "code review" from one mentioning
code in one paragraph and review in another.

## Considered Options

**Leaving the default at `updated_at` and offering `relevance` opt-in.** Rejected: the web
sends `sort_by` on every request, so an opt-in default would have reached nobody, and a
caller who types a search term has already said what they want ranked.

**Refusing `sort_by=relevance` when there is no `q`.** Rejected as a refusal for a parameter
the user never typed — clearing the search box would 400 a page that had been working. It
falls back to `updated_at` instead. The same rule resolves both directions and lives in
`shared` (`resolveSkillDirectorySortField`), because the API resolves it out of a query string
and the web resolves it out of URL state and sends the result back; a web default that
differed would make a shared link render differently from the page it was copied from.

**Trigram fuzzy matching for typos.** Genuinely wanted — `angulr` finds nothing today — and
deferred rather than rejected. It needs `CREATE EXTENSION pg_trgm`, which is a new deployment
requirement, and it is separable: a fallback that runs only when the full-text query returns
no rows. Worth doing on its own.

**Indexing Tag names into the vector.** Rejected for now: `tag_id` already filters, tags are a
join rather than a column so they cannot enter a generated column, and a trigger to maintain
them is more machinery than the gap justifies.

## Consequences

**A generated column's expression cannot be altered in place.** Migration `0002` drops
`resource_directory`, drops and re-adds the column, recreates the GIN index, and recreates the
view. The view is reproduced verbatim from `0001_views.sql`, which stays the definition of
record for everything else about it.

**The vector now stores the whole `SKILL.md` body per Resource**, so the column and its index
are meaningfully larger. Bounded by what a publish may declare, and `tsvector`'s own 1 MB
ceiling is far above anything a `SKILL.md` reaches.

**Rank ties are common** — every Resource matching the same single low-weight lexeme scores
alike — so relevance ordering breaks ties on `updated_at` before `id`, which is insertion
order and reads as arbitrary.

**`sort_by`'s refusal message changed**, since it enumerates the valid values.

**The MCP server sends no `sort_by` at all**, so the Registry's own default applies: relevance
for a query, recency for a bare listing. Both are what that caller wants, and pinning either
would be wrong for the other.
