# Tags Are a Catalog, Not a Per-Skill Array

**Status:** supersedes the storage shape described in ADR-0008 (its actual reasoning — tags
are registry-owned metadata, never written into `SKILL.md` — still stands unchanged).

A Skill's tags are a many-to-many relationship to a registry-wide `tags` catalog table via a
`skill_tags` join table, not a `text[]` column on the Skill's own row. Each Tag has a stable
`id` and a `name`; a Skill references Tags by `id`, so renaming one (`PATCH /tags/{id}`) is
visible on every Skill carrying it without touching a single `skill_tags` row. We chose this
over the plain array because a free-text array has no way to notice that `"AI"`, `"ai"`, and
`"artificial-intelligence"` are three spellings of what a reader means as one tag — every
Skill ends up curating its own private vocabulary instead of sharing the registry's. A
catalog table is the standard fix, and it's also how Notion's own multi-select property
works: options live on the schema, a page's value is a set of references to them by id, and
renaming an option updates every page holding it (see Notion's public API docs for the
`multi_select` property type).

## Considered Options

Keeping the `text[]` column from ADR-0008 was considered and rejected for the drift reason
above — it also has no way to support renaming a tag without rewriting every row that
happens to contain the old spelling. A version scoping the catalog per something narrower
than the whole Registry (e.g. per publisher) was not considered: the Registry already serves
exactly one team (CONTEXT.md), so there is nothing narrower to scope it to.

## Consequences

Every Skill read now does one extra join (or, for a list of Skills, one extra query against
`skill_tags`/`tags` keyed by the whole page of ids at once) instead of reading a column
already on the row. A Tag can also outlive every Skill that once carried it — detaching the
last reference does not delete the catalog row (no route deletes a Tag at all yet) — so the
catalog can accumulate entries nobody is using; that's an accepted, deferred concern rather
than one this decision tries to solve.
