# 41. A Resource records where it came from

## Status

Accepted. Amends [ADR-0026](0026-resource-with-a-kind-and-a-payload.md); narrows the
"keeps no reference" language in the Import term of `CONTEXT.md`, without reopening
[ADR-0001](0001-registry-does-not-inspect-artifacts.md).

## Context

A Resource could arrive two ways and read identically afterwards: Imported out of a repository,
or published straight to the Registry from the CLI, the MCP server, or a drag-and-drop. Nothing
on the row said which, so "where did this Skill come from?" — the first question anyone asks of
a Skill they did not publish — had no answer at all.

The Import term said the Registry "keeps no reference to where it came from". That sentence was
doing two jobs. One was a real decision: an Import is a one-time copy, never re-read, never
synced. The other was an accident of it: because nothing was stored, provenance was lost too.
Only the first is worth keeping.

## Decision

A Resource carries a `source`.

**Stored** as a nullable `resources.source` column — a column rather than a payload key, because
every Kind comes from somewhere, so this is Resource-level the way `name` and `description` are
rather than part of any one Kind's shape (ADR-0026).

**Written** only when there is something to write: an Import records the repository URL. A
publish that declares no source stores null, and a republish that declares none clears whatever
an earlier Import recorded, matching the full-replace semantics everything else on a publish
already has (ADR-0002).

**Resolved on read** into a value that is never null. A stored URL reads as itself; null reads as
this Registry's own domain in reverse-DNS notation, derived from `PUBLIC_URL` — `com.quicko.skills`.
Every read path goes through one resolver, so no client ever sees the column's null.

**Declared by the publisher**, not inferred. Only the publisher knows whether the bytes were
fetched from a repository or picked off a disk, and the Registry will not open the Artifact to
find out (ADR-0001). The declared value is held to an absolute `http(s)` URL: the reverse-DNS
form is not declarable at all, so nobody can claim to be a Registry they are not.

The stored URL names the **repository**, without the ref or the folder within it.

## Consequences

The reverse-DNS fallback is not stored, which is the whole point of resolving it. It is this
Registry's identity — configuration — rather than a fact about the Resource, so writing it into
every row would duplicate `PUBLIC_URL` into data, go stale the day the deployment moves, and
leave every Resource published before this column existed needing a backfill the migration
cannot perform. Resolving instead means the rows already there read correctly the moment the
column ships.

The two forms are deliberately different in shape, and a surface that shows a Source shows only
the first. A URL is an address, rendered as the Git Provider's mark linking out to it; the
reverse-DNS form is an identity, with nothing at `com.quicko.skills` to navigate to, and naming
the Registry a reader is already looking at tells them nothing — so it is not shown at all, and
the row is absent rather than blank. `importedSource` is the one function that decides this, so
every surface agrees on which Sources are worth showing.

The value is still resolved rather than returned null, because the API's answer and the
interface's are different questions. `GET /resources` answers "where did this come from",
which always has an answer; the interface answers "is there somewhere else to look", which does
not. An agent reading the API can tell a first-party Resource from an Imported one without
knowing which Registry it is talking to — so the MCP server keeps reporting it.

Every Skill imported out of one monorepo records the same source. That is the honest answer —
the repository is what they came from — and it is the one that stays right when a folder is
later moved. A ref is left out for a stronger reason: it named a branch at import time and
means nothing afterwards, because an Import is never re-read.

This is provenance, not a link. Nothing re-reads the source, nothing syncs from it, and a
repository that moves or disappears leaves the recorded value untouched and wrong — which is
what a historical record is. Continuous sync remains out of scope, and would be its own
decision.

The declared source is not verified. A writer could publish from disk while claiming a
repository URL, and the Registry would record it. Checking would mean fetching the repository at
publish time, which is a network call on the write path to defend against a writer this Registry
has already trusted with publishing.
