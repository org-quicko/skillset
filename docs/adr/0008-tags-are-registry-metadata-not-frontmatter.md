# Tags Are Registry Metadata, Not Frontmatter

**Status:** the storage shape below (`text[]` column) is superseded by ADR-0011 — tags are
now a catalog table plus a join table. The reasoning on this page (never written into
`SKILL.md`, edited entirely server-side) is unaffected and still holds.

A Skill's tags are stored as a column on its row in the Registry's own database, set and
edited entirely server-side — never written into the `SKILL.md` file itself, unlike every
other attribute the summary view displays. We chose this because the Agent Skills spec's
`metadata` field is a string-to-string map, not a list, so representing tags there would
mean inventing a private delimiter convention on top of the spec, and any edit would
require re-uploading the Artifact rather than a simple database update.

## Considered Options

Storing tags inside frontmatter's `metadata` field (e.g. `metadata.tags: "a,b,c"`) was
considered and rejected for the reasons above.

## Consequences

Tags are the one Skill attribute the Registry can show or change without the Artifact
being touched at all — but also the one attribute that doesn't travel if a Skill is ever
exported or mirrored elsewhere, since it lives only in this Registry's own database, not
in the portable file.
