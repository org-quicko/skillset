# Skill Install Tracking and Browsing

Status: ready-for-agent

## Problem Statement

Nobody can tell how much a Skill is actually used. The Skill Summary Widgets effort added an
analytics widget to a Skill's own page, but left it a static placeholder — "Installs aren't
tracked yet" — because nothing counted installs at all.

Tags exist on a Skill, but they're inert for browsing: there is no way to filter the Skill list
by Tag, and the list only ever sorts one way, most-recently-published. Search finds a Skill by
its own name or description, but not by who published it, so "the Skill Priya wrote" isn't
findable without already knowing its name. And as the catalog grows past a handful of Skills, a
Previous/Next click-through doesn't scale to actually browsing what's there.

## Solution

Every download of a Skill's Artifact increments a running install count for that Skill — there's
no CLI install path yet to add to it, but the counting function is shaped so ticket 09
(`skillreg add`) can call it once it exists. The count replaces the "not yet tracked" placeholder
on a Skill's own page, and becomes a first-class column on the Skill list.

The Skill list itself is rebuilt around this and around Tags: a reader can filter by one or more
Tags (matching any of them), sort by install count or by when a Skill was last updated, search by
name, description, or publisher in the same box, and scroll to load more instead of clicking
through numbered pages. The whole thing sits on a shadcn DataTable, and every sort, filter, or
search change goes back to the server rather than being recomputed over rows already loaded.

## User Stories

### Seeing how much a Skill is used

1. As a reader, I want to see how many times a Skill has been installed on its own page, so that
   I can judge how much the team already relies on it before I read further.
2. As a reader, I want that number to read `0` for a Skill nobody has installed yet, not a
   placeholder or a gap, so that I can trust it's a real measurement, not a promise of one to
   come.
3. As a reader downloading a Skill, I want my download to count automatically, so that the number
   reflects real usage without me doing anything extra.
4. As a reader, I want a hiccup recording my download to never stop the download itself, so that
   a bookkeeping problem on the Registry's side can't get in the way of the Skill I came for.
5. As a reader relying on install counts to judge a Skill's adoption, I want the count driven only
   by genuine downloads (and, later, genuine CLI installs), not something any client could inflate
   by calling an endpoint directly, so that the number stays trustworthy.
6. As a reader, I want a download from the web and an install via the CLI (once it exists) to add
   to the same total, so that the count reflects a Skill's whole usage, not just one surface.

### Filtering, sorting, and searching the list

7. As a reader, I want to filter the Skill list down to one or more Tags, so that I can narrow to
   a topic I care about instead of scanning every row.
8. As a reader, I want selecting several Tags to show a Skill carrying any one of them, so that I
   can broaden my search across related topics in a single filter rather than repeating it per
   Tag.
9. As a reader, I want to sort the list by install count, so that I can see what the team already
   relies on most.
10. As a reader, I want to sort the list by when a Skill was last updated, so that I can see what
    changed recently.
11. As a reader, I want the list to default to most-installed-first, so that opening the Registry
    surfaces what's actually in use, not just whatever was published last.
12. As a reader, I want my search to also match a Skill's publisher, so that I can find "the Skill
    Priya wrote" without already knowing its name.
13. As a reader, I want search, my Tag filter, and my sort choice to combine rather than one
    overriding another, so that I can narrow by topic and see it ordered by usage at the same
    time.
14. As a reader, I want an empty search with no filters to show the ordinary full list, so that
    clearing everything returns me to a sensible default rather than an empty page.
15. As a reader, I want the list to keep loading more results as I scroll, so that I'm not
    clicking through numbered pages to see what's there.
16. As a reader, I want changing my search, filter, or sort to start the list over from the top,
    so that I'm not looking at results from my old query mixed in with my new one.
17. As a reader, I want my search term, Tag filter, and sort choice reflected in the page's URL,
    so that I can bookmark or share a specific view of the list.
18. As a reader, I want the list to still show each Skill's Tags as chips, so that I can tell why
    a row matched my filter, or spot a Tag worth filtering by next.
19. As a reader, I want the list's date column to show when a Skill was last updated rather than
    when it was first published, so that a recent edit to an old Skill visibly surfaces it as
    current.
20. As a reader, I want clicking a column's sort control to fetch freshly sorted results from the
    server, so that sorting isn't limited to only the rows my browser has already loaded.
21. As a reader, I want browsing, filtering, sorting, and searching the list to need nothing more
    than being signed in, so that this isn't gated behind a role beyond what browsing already
    requires today.

## Implementation Decisions

### Schema

- A new `skill_analytics` table: one row per Skill it's ever recorded a count for, holding an
  `install_count` (starts at 0, only ever increases) plus the usual `created_at`/`updated_at`
  pair. No row exists for a Skill until its first recorded install — there's no backfill, and no
  companion write on publish. A Skill with no row simply reads as `0` wherever its count is shown.
- `skills` gains one new column, `published_by_name`: a snapshot of the publisher's display name,
  written the same moment `published_by_email` already is (on every publish, insert or replace),
  for the same reason — attribution and searchability that survive the publishing User being
  removed or renamed later. It is never null, since publishing already requires an authenticated
  User. Existing Skills get it backfilled once, from the User each currently references, as part
  of this migration.
- The `search` generated column on `skills` — currently `name` plus `description` — is extended to
  also fold in `published_by_name`, so full-text search covers a Skill's publisher without a
  query-time join. This is a hand-written migration, the same way the original `search` column
  was, since Drizzle has no native generated-column support.
- A new view, `skill_directory`, joins `skills` to `skill_analytics` (so a Skill with no analytics
  row still reads `0`) and aggregates each Skill's Tags into an array, exposing one row per
  Skill: id, name, description, `published_by_name` as the publisher, `updated_at`, and the
  install count. Tag *filtering* (matching a Skill against one or more selected Tag ids) is done
  as a membership check against `skill_tags` directly in the query that reads from this view, not
  as a condition against the view's own aggregated Tags column.

### Recording an install

- A single internal function, not a public endpoint, upserts `skill_analytics` with an atomic
  `install_count + 1`. Called from inside the existing download-artifact flow, at the moment the
  presigned S3 URL is issued — the only point the API can observe a download request, since the
  file itself transfers directly from S3 and the API never sees it finish.
- The write is best-effort: a failure is logged and swallowed, never surfaced to the caller or
  allowed to fail the download response.
- The function takes just a Skill's id, with no assumption about which surface called it — so
  ticket 09 (`skillreg add`, CLI install) can call the same function once it's built, without this
  effort needing to guess at its shape.

### Reading

- Both a Skill's single-detail read and its list-summary read gain an `installs` field (an
  integer, defaulting to `0`, never null) drawn from `skill_analytics` the same way.
- A Skill's list-summary read also gains the aggregated `tags` (the same `{id, name}[]` shape the
  Tags feature already established), the publisher (now `published_by_name` rather than a live
  join to `users`), and `updated_at` in place of `published_at` for this listing specifically —
  `published_at` is untouched everywhere else it's used (e.g. a Skill's own detail page).
- `GET /skills` gains four query parameters alongside the existing `page` and `q`: a repeatable
  Tag-id parameter (any-match — a Skill qualifies if it carries at least one of the given Tags),
  `sort_by` (`installs` or `updated_at`; defaults to `installs`), `sort_order` (`asc` or `desc`;
  defaults to `desc`), and `page_size` (client-supplied; defaults to 10, clamped between 1 and
  100). `sort_by`/`sort_order` always govern ordering, including while a search term is active —
  there is no separate relevance ranking. An invalid value for `sort_by` or `sort_order` is
  rejected with the same field-named validation error the rest of the API already gives bad input;
  `page_size` outside its bound is clamped rather than rejected.
- No new role requirement — browsing, filtering, sorting, and searching stay behind the same
  `requireAuth` check `GET /skills` already has today.

### Web interface

- The existing Skill list (`skill-list.tsx`/`skills-panel.tsx`) is rebuilt on shadcn's DataTable
  rather than replaced with a new page. Columns: Name, Description, Publisher, Updated, Installs,
  and Tags (as chips) — `Published` is gone from this table, replaced by `Updated`.
- Sorting is server-driven: clicking a column's sort control issues a fresh `GET /skills` request
  with the corresponding `sort_by`/`sort_order`, rather than re-sorting rows already in the
  browser.
- Pagination becomes infinite scroll (an infinite query against the same `page`/`page_size`
  contract), replacing the Previous/Next controls. Changing the search term, Tag filter, or sort
  resets the accumulated list back to page one.
- A new multi-select Tag filter control sits alongside the existing search box.
- Search term, selected Tags, and sort choice move into the URL via the app's existing router
  rather than the `useState` that holds this state today — consistent with this repo's
  router-over-`useState` convention, and what makes a specific view of the list bookmarkable.
- The existing analytics-widget placeholder on a Skill's own page ("Installs aren't tracked yet")
  is replaced with the real `installs` value from that same read.

## Testing Decisions

A good test here states a rule from the sections above and checks it through a request in, a
response and a database effect out — never a module's internals or an intermediate value.

**Single seam: the API request boundary (Seam 1)** — the existing seam already covering
publishing, reading, deleting, and tagging a Skill. This effort adds no new seam. It's proven
there by: downloading a Skill's artifact through the existing route increments its
`install_count`, repeated downloads accumulate, and a never-downloaded Skill reads back `0` rather
than null or absent, on both the detail and list reads; `GET /skills`'s new query parameters —
multiple Tags (any-match), both `sort_by` values in both directions, and a client-supplied
`page_size` (including its clamped bounds) — each produce the expected set, order, and page size;
a search term matching only a Skill's publisher still returns that Skill, both for a Skill
published after this migration and one backfilled by it.

Recording an install being best-effort (a failed write never blocks the download) is a real
guarantee but not one this seam can cheaply prove without fault injection — nothing in a normal
request path fails. It's an implementation guarantee (the write wrapped in try/catch) rather than
something the automated suite asserts, unless a cheap way to force that path to fail turns up
during implementation.

The web interface gets no seam of its own, consistent with the master spec and the Skill Summary
Widgets spec before it: this repo has no test runner configured for `apps/web` at all, and the
DataTable/infinite-scroll/URL-state wiring is glue over a contract Seam 1 already proves — a
component harness would exercise TanStack Table and the router, not a decision recorded above.

## Out of Scope

- Any CLI implementation. `skillreg add` (ticket 09) remains blocked on its existing dependencies
  and is untouched by this effort; when it's built, it should call the same `recordInstall`
  function this effort introduces, so CLI installs count too.
- A public, callable "record an install" endpoint. Only the download flow (and later, the CLI)
  triggers a count — never something a client can invoke directly.
- Decrementing or uninstalling. Install counts only ever go up.
- Any history of installs over time, or a "trending this week" view. Only a single running total
  per Skill exists; no event log.
- Filtering the list by publisher. Publisher only affects what a search term can match, not a
  filter control of its own.
- Relevance-ranked search results. `sort_by` governs order unconditionally, even with a search
  term active.
- Live-updating publisher names. `published_by_name` is a snapshot taken at publish time; a User
  who renames themselves doesn't change how their already-published Skills search or display
  until those Skills are republished.
- A control for changing page size in the UI. The API accepts `page_size`; nothing in this effort
  adds a way to set it from the browser beyond infinite scroll's own paging.
- Anything on a Skill's own detail page beyond wiring its existing analytics placeholder to a real
  number — `published_at` and everything else on that page is untouched.

## Further Notes

This effort is the "later effort" two prior specs explicitly deferred to. The Skill Summary
Widgets spec added the analytics widget as a static "not yet tracked" placeholder and said
outright: "no counter, event, or table is introduced" — this effort introduces exactly that. The
Tags spec explicitly called "browsing/filtering the Skill list by tag" out of scope for itself.
Together with the master spec's own "Search ranking controls, filters, or saved searches. One
search input, one result list," this effort reverses that line by adding a Tag filter and a sort
control — worth knowing if anyone goes looking for why that line no longer holds.

The glossary (`CONTEXT.md`) has no entry for "install" as a countable event, distinct from
Download (already a defined action) or a hypothetical formal "Install" term — ticket 09 already
uses "install" informally as the CLI's verb, and this effort adds a second sense (a counted event)
without naming it as a term of its own. Worth raising with `/domain-modeling` if it comes up
again.

`docs/data-model.md` and `docs/openapi.json` need updating to match, as part of implementing this
rather than a separate follow-up — the same expectation the last two specs recorded.
