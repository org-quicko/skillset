# Overwrite Instead of Versioning

> **Amended by ADR-0026.** `name` is now unique per Kind rather than registry-wide, and
> it no longer keys the Artifact in storage — the Resource's `id` does. Overwrite instead
> of versioning, hard delete, and bucket versioning as the recovery path are unchanged.

A Skill is identified by the flat `name` from its frontmatter, with no namespacing and no
version history: pushing a Skill replaces the Artifact and the row that are already there,
and deleting one removes both permanently. We chose this because the Registry serves a
single team, where `code-review` is the team's Skill and whoever improves it should be able
to publish it.

## Considered Options

Immutable versions under `skills/<name>/<n>/` with `latest` as a pointer, and owner
namespacing (`matt/code-review`), were both rejected — namespacing solves a collision
problem one team does not have, and versions add a concept to every URL, CLI argument, and
object key.

Soft delete was rejected specifically because `name` is the sole identity: a tombstoned
`code-review` forces a re-push to either resurrect someone else's provenance or collide
with a row nobody can see.

## Consequences

Overwrite and hard delete are both irreversible in the application, so **object storage
bucket versioning is the recovery path** and must stay enabled. It costs one bucket setting,
recovers from both operations, and adds nothing to the domain model.

Any writer can overwrite any Skill, so `pushed_by` and `pushed_at` are not decoration —
they are the only way to answer "who changed this".

Changing `name` in frontmatter and pushing creates a **second** Skill rather than renaming
the first; there is no way to detect a rename without the CLI tracking prior state. The old
one lingers until an Admin deletes it.
