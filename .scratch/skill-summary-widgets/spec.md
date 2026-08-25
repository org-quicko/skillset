# Skill Summary Widgets

Status: ready-for-agent

## Problem Statement

A reader opening a Skill today gets a single card: a back link, a name and description with Download and Delete crammed into the same header, and the rendered `SKILL.md` body underneath. That card cannot show anything else a Skill's author wrote, because the Registry only ever kept two things from a Skill's frontmatter — `name` and `description` — and silently threw away everything else, even though the Agent Skills specification defines four more optional fields (`license`, `compatibility`, `metadata`, `allowed-tools`). A writer who carefully filled in a `license` or `allowed-tools` line has no way to know the Registry never looked at it. There is also no way to tell how much a Skill is actually used, and no way to group or browse Skills by topic — both things a team adopts once a Registry has more than a handful of Skills in it.

## Solution

The Skill's page becomes several distinct widgets instead of one card: a small back control; a frontmatter widget listing whichever spec fields a Skill's `SKILL.md` actually set and passed validation for; the rendered `SKILL.md` body, unchanged; a placeholder analytics widget; and the existing Download and Delete actions, grouped together. Publishing now validates every field the specification defines, not just `name` and `description` — a Skill whose optional frontmatter breaks a rule is rejected outright, with the same specific, field-named error a bad `name` already gets today. Every Skill also gains a `tags` field: registry-owned, never written into the file itself, and read-only for now — there is no way yet to set one, so the frontmatter widget will show none until a later effort builds that.

## User Stories

### Reading a Skill's summary

1. As a reader, I want the Skill's page broken into separate widgets instead of one dense card, so that I can find what I'm looking for without scanning past everything else.
2. As a reader, I want a compact back control rather than one stretched across the page, so that it reads as navigation chrome, not a widget of its own.
3. As a reader, I want a frontmatter widget that lists a Skill's `license`, `compatibility`, `metadata`, and `allowed-tools` when its author set them, so that I can judge a Skill without downloading it first.
4. As a reader, I want a frontmatter field that's missing entirely to simply not appear in the widget, rather than showing as "not set," so that the widget only ever shows me facts, not gaps.
5. As a reader, I want a frontmatter field that's present but fails the specification's rules to also not appear, exactly as if it were absent, so that a widget author's typo doesn't show me a broken or confusing value.
6. As a reader, I want the `SKILL.md` body rendered exactly as it is today, so that this redesign doesn't regress how I read a Skill's instructions.
7. As a reader, I want an analytics widget showing installs, so that I can gauge how much the rest of the team already relies on a Skill.
8. As a reader, I want that analytics widget to say plainly that the number isn't tracked yet rather than show a fabricated zero, so that I don't mistake "not measured" for "never installed."
9. As a reader, I want Download and Delete grouped together as one actions widget, so that the header isn't doing double duty as both a title and a toolbar.
10. As a reader, I want Download and Delete to work exactly as they do today, so that this redesign doesn't quietly change what either button does.
11. As a reader, I want tags shown on the frontmatter widget when a Skill has any, so that tagging has somewhere to render the moment a later effort adds a way to set them.
12. As a reader, I want a Skill with no tags to simply show none, so that the widget doesn't clutter every Skill's page with an empty "Tags: —" line before tagging exists.

### Publishing with the fuller frontmatter

13. As a writer, I want my Skill's `license`, `compatibility`, `metadata`, and `allowed-tools` to actually reach the Registry when I publish, so that setting them in my `SKILL.md` isn't wasted effort.
14. As a writer, I want publishing rejected outright if any of those fields breaks the specification, so that I learn immediately rather than wondering later why a field never shows up.
15. As a writer, I want the rejection to name the specific field and rule that failed, exactly as a bad `name` or `description` already does, so that I can fix it without guessing.
16. As a writer, I want that same rejection whether I publish from the CLI or the web interface, so that the two surfaces never disagree about whether my Skill is valid.
17. As a writer, I want replacing an existing Skill to leave its tags alone, so that publishing a new version of my Skill can never silently wipe out tags a future feature let someone else add to it.
18. As a writer publishing a Skill with none of the four optional fields set, I want publishing to succeed exactly as it does today, so that this change adds nothing I'm required to fill in.

## Implementation Decisions

### Frontmatter parsing and validation

- The shared parser that reads a `SKILL.md`'s frontmatter is extended to also extract `license`, `compatibility`, `metadata`, and `allowed-tools` — all optional, matching the Agent Skills specification exactly (name and description remain the only required fields).
- One new validation rule per field, added to the same rule set `name`, `description`, and `body` already belong to, each throwing the same kind of error, carrying the same specific rule code and field name, on failure:
  - `license`: when present, must be a non-empty string.
  - `compatibility`: when present, must be a string of at most 500 characters (the specification's own limit).
  - `metadata`: when present, must be a plain object mapping string keys to string values — no nested objects, arrays, or non-string values.
  - `allowed-tools`: when present, must be a string. Its internal grammar is treated as the specification's own "experimental" territory and is not further validated.
- Validation of all four is unconditional and applies equally whether a Skill is being published for the first time or replacing an existing one. There is no partial acceptance: if any field, required or optional, fails its rule, nothing about the Skill changes and the whole publish is refused. This is ADR-0009.
- These rules live in the one shared module both the CLI and the web interface already validate against before uploading anything, and that the API re-validates on the posted payload — so this is one rule set, not three copies of one.

### Wire contract and storage

- The publish request payload gains four new optional keys alongside the existing `description` and `body`, one per new field.
- A Skill's read shape (both the single-Skill and the list-summary shapes) gains the same four fields, each present only when the Skill has a valid value for it, plus a fifth: `tags`, an array of strings.
- The Skills table gains five new nullable columns: one per frontmatter field, plus `tags`. None of the four frontmatter columns carry a default; a Skill published before this change, or published since without setting a given field, simply has it absent.
- Publishing writes the four frontmatter columns (whatever validated, or absent) every time, exactly as it already does for description and body. Publishing never touches the `tags` column in either direction — not on insert, not on the conflict-update path that replaces an existing Skill — because nothing in this effort creates a way to set a tag. This is ADR-0008.
- Tags are never parsed out of, or written into, a `SKILL.md` file. They are the one Skill attribute that exists solely as registry-owned data.

### Web interface

- The single card the Skill's page renders today is split into five pieces, arranged in two columns beneath a compact back control that sits outside both:
  - Left column: a frontmatter widget (name, description, and whichever of the four optional fields plus tags are present), above the existing rendered-`SKILL.md`-body widget, unchanged.
  - Right column: an analytics widget showing installs as explicitly not yet tracked, above an actions widget holding the existing Download link and, for callers permitted to delete, the existing Delete button and its confirmation dialog.
- No new data-fetching hook is needed — the single query that already fetches a Skill's detail is extended to include the five new fields, and the widgets simply render subsets of the one result.
- The back control keeps navigating exactly as it does today; only where it sits in the layout changes.
- No changes to the Skill list page, publish flow, or delete confirmation flow beyond consuming the wider read shape.

## Testing Decisions

A good test here states a rule from the sections above and checks it through a request in, a response and a database effect out — never a module's internals or an intermediate value.

**Single seam: the API request boundary** (the existing seam that already covers publishing, reading, and deleting a Skill). This effort adds no new seam. The four new frontmatter rules are proven the same way `name`, `description`, and `body`'s rules already are at this seam: a table of publish payloads, one per rule, each expecting a 400 with that rule's specific code and field and no row written. Additional cases prove a fully-populated payload's fields all round-trip unchanged through a subsequent read, and that replacing an existing Skill through publish leaves its `tags` column untouched.

The shared module's own YAML-extraction glue for the four new fields — pulling `fields.license` and so on off an already-parsed frontmatter mapping — is not independently tested. It is exercised in substance by the same validation functions the API-boundary tests already drive directly on a payload, and is no more complex than the equivalent, already-untested glue for `name` and `description`. Collapsing to one seam accepts this rather than adding a second one to close it.

The web interface gets no seam of its own, consistent with the master spec: the widgets are glue over a read shape the API-boundary tests already prove is correct, and rendering them a component-test harness would only re-exercise React and the markdown renderer, no decision recorded above.

## Out of Scope

- Any real install- or download-tracking. The analytics widget is a static "not yet tracked" state; no counter, event, or table is introduced.
- Any way to set, edit, or remove a tag. `tags` is read-only in this effort; every existing and newly published Skill will show none until a later effort adds that.
- Filtering, searching, or listing Skills by tag.
- A tags input on the publish flow (CLI or web).
- Any additional frontmatter field beyond the six the Agent Skills specification defines. A custom, registry-specific frontmatter key is not introduced.
- Backfilling the four new frontmatter fields onto Skills published before this ships. They simply have none of the new fields until republished.
- Relaxing "reject the whole publish" into a partial-acceptance mode for optional fields, now or as a follow-up default.

## Further Notes

Two decisions here are recorded as ADRs because they are easy to get "fixed" by someone who does not know why they're this way: `tags` living only in the Registry's own database rather than in `SKILL.md` (ADR-0008), and publishing rejecting the whole upload over one non-compliant optional field rather than dropping just that field (ADR-0009).

This effort reverses part of one line in the original Skill Registry spec's "Out of Scope" — "Categories or tags on Skills, and therefore filtering or listing by them" — by giving tags a home. Filtering and listing by them remain out of scope, per that same line, until a later effort takes them on.

`docs/data-model.md` and `docs/openapi.json` describe the current two-field frontmatter and the current wire shapes; both need updating to match this spec as part of implementing it, not as a separate follow-up.
