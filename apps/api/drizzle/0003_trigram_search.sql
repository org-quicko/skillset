-- Trigram matching, for the fuzzy fallback a mistyped search term takes
-- (ADR-0040). Only `word_similarity()` is needed from the extension; see
-- `buildFuzzyMatcher` in resources.service.ts for why no trigram index comes
-- with it.
--
-- Deliberately NOT schema-qualified, unlike everything else in these
-- migrations. An extension installs into the first schema on the search_path
-- — `public` here, since this app sets no search_path of its own (ADR-0036) —
-- and `public` stays on the search_path whatever DB_SCHEMA names, so
-- `word_similarity()` resolves unqualified from any schema. Installing it into
-- DB_SCHEMA instead would hide it from exactly the deployments that variable
-- exists for.
--
-- `IF NOT EXISTS` is the escape hatch for a deployment whose application role
-- cannot CREATE EXTENSION: a DBA pre-creates it once, and this becomes a
-- no-op rather than a failed migration. See README, "Fuzzy search".

CREATE EXTENSION IF NOT EXISTS pg_trgm;
