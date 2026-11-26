# 46. A writer can re-Import a Plugin from its Source

## Status

Accepted. Amends [ADR-0041](0041-a-resource-records-where-it-came-from.md), which said nothing
ever re-reads a Source. Continuous sync stays out of scope.

## Context

A Plugin changes: its authors ship a new version, and everyone who installed it should get it —
through `skillset plugins update`, and through Claude Code's marketplace, both of which follow
a republish because it overwrites in place (ADR-0002) and moves `updated_at`.

Publishing a new version was already possible, but only by starting over from the home page's
publish dialog. That had two traps. A folder dropped there publishes with no Source, so a Plugin
first Imported from `acme/plugins` landed beside itself in the Registry's own Namespace instead
of replacing itself (ADR-0042). And an Imported Plugin could only be refreshed by finding its
repository again by hand, though the Registry had recorded it.

## Decision

A Plugin's page offers writers **Publish a new version**, which publishes over that Plugin and
nothing else:

- **From its repository**, when its Source is a repository this Registry reads. This reads the
  Source again on demand — a re-Import. The Source names the repository but not the folder
  (ADR-0041), so the folder is found again by the name in its manifest.
- **From a folder** dropped or picked, for any Plugin.

Either way the new files must name the same Plugin; anything else is refused before publishing,
because it would publish a second Plugin rather than a new version. An Imported Plugin is
republished with its recorded Source, so it keeps its Namespace and identity.

## Consequences

ADR-0041's "nothing re-reads the source" no longer holds for Plugins: a writer can ask for it to
be read again, and only then. Nothing reads it on a schedule or on a push, so a Source is still
provenance first — a repository that moves still leaves it stale, and re-reading then fails with
the folder not found, which is the honest answer.

A folder uploaded over an Imported Plugin keeps that Plugin's repository as its Source even
though the bytes came off a disk. That is the same unverified declaration ADR-0041 already
accepts from any writer, and it is what keeps the Plugin one Resource rather than two.

Skills are unchanged: the request was about Plugins, and a Skill's update path through the CLI
(`skillset publish`) already exists.
