# Publish Rejects Non-Compliant Optional Frontmatter Fields

Publishing a Skill validates all six Agent Skills spec frontmatter fields, not just the
required `name` and `description`, and rejects the entire upload with a field-specific
error if any of them — required or optional — violates the spec (a `metadata` value that
isn't a string, a `compatibility` string over 500 characters, and so on). We chose this
over silently dropping just the offending field so a Skill author learns immediately when
something they wrote won't reach the Registry, consistent with how a bad `name` or
`description` already fails publish today.

## Considered Options

Silently omitting an invalid optional field while still accepting the rest of the file was
considered and rejected — it would work quietly until the day someone wonders why the
summary view never shows the `license` they set on a given Skill.

## Consequences

A Skill that was valid under the old two-field parser can start failing to publish once
these four fields are validated, if its `SKILL.md` happens to contain something like a
non-string `metadata` value the author never noticed. There is no partial-publish state:
either the whole frontmatter is compliant or nothing changes in the Registry.
