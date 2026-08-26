# Tags for Skills

Written up after the fact from a grilling session (no GitHub issue exists for this feature) —
this is the record of what was actually agreed, for review purposes.

## What to build

Let a Skill be tagged after upload, with tags editable afterward. Multiple tags per Skill.

## Decisions

- **Storage shape**: a registry-wide `tags` catalog table (`id`, `name`) plus a `skill_tags`
  join table — not a `text[]` column on `skills`. A Skill's tags are computed via a join at
  read time, never stored redundantly on the Skill's own row.
- **Tag name format**: lowercase alphanumerics and hyphens, no leading/trailing/doubled
  hyphen (same shape as a Skill's name), max 32 characters, normalised (trimmed, lowercased)
  on write. No cap on the number of tags per Skill.
- **Attach / create / detach** — `PUT /skills/{id}/tags`, full replace by name (not
  incremental add/remove), `writer` role minimum (same bar as publishing). A name with no
  catalog match is created on the spot ("find-or-create") — no separate create-only endpoint.
  Detaching a tag from a Skill never deletes it from the catalog; an unused tag just sits
  there (no delete-a-tag route exists at all yet — explicitly out of scope).
- **Rename** — `PATCH /tags/{id}`, `admin` role minimum (stricter than attach, since a rename
  reaches every Skill carrying that Tag, not just the one being edited). Every Skill
  referencing the Tag's id picks up the new name automatically. Renaming to a name a
  *different* Tag already holds is rejected with a 409 conflict — no auto-merge.
- **Catalog listing** — `GET /tags`, any authenticated User, alphabetical by name. Exists so a
  tag editor can autocomplete against existing tags (the whole reason for a catalog over a
  plain per-Skill array: prevent "AI" vs "ai" vs "artificial-intelligence" drift).
- **Wire shape** — a Skill's `tags` field is `{ id, name }[]`, not `string[]` — the `id` is
  what the UI needs to call the rename endpoint.
- **Explicitly out of scope for this piece of work**: browsing/filtering the Skill list by
  tag (the list view is untouched — tags still only show on the Skill detail page), and any
  catalog-wide "delete a Tag" or "manage tags" surface.
- **UI**: an "Edit tags" button in the Skill detail page's Actions card, opening a dialog
  (matching the existing Delete-confirmation dialog's pattern) — not an inline edit-in-place
  on the frontmatter display card. Autocomplete suggests existing catalog tags while typing;
  typing a new name creates it on save. Admins additionally get an inline rename control
  (pencil icon) on each tag chip inside that same dialog — takes effect immediately (it's a
  separate request from saving the Skill's own tag list), not deferred to "Save tags".

## Acceptance criteria

- [ ] Publishing/republishing a Skill never touches its tags (unchanged from before this work).
- [ ] A writer can attach an existing or brand-new tag to a Skill via the UI, and it persists.
- [ ] A writer (not admin) is refused `PATCH /tags/{id}` with 403.
- [ ] A reader is refused both tag-writing endpoints with 403.
- [ ] Renaming a Tag updates its name everywhere it's attached, without touching any Skill's
      own row or requiring a re-save of any Skill's tag list.
- [ ] Renaming to a name already held by a different Tag is rejected (409), not merged.
- [ ] Detaching a Skill's last reference to a Tag leaves the Tag in the catalog.
- [ ] The Skill list view shows no tag chips and gained no filter control.
