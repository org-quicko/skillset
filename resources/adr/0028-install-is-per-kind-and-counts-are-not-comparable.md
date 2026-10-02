# Install Is Per-Kind, and Counts Are Not Comparable

An Install stays one immutable row per occurrence, but "obtained" now means something different
per Kind: a Download of the Artifact for a Skill or a Plugin, and the config being written
(`skillset install`) or revealed (an explicit `POST` from the web interface) for an MCP Server. The
event log becomes `resource_install_events`, the materialized view `resource_analytics`, and both
keep their existing shape. Because the counted acts differ, **`GET /resources` no longer sorts by
`installs` by default — `updated_at` does.**

> **Amends ADR-0012.** The event-log-plus-materialized-view design, the periodic
> `REFRESH MATERIALIZED VIEW`, the "absent means 0" contract, and the deferred
> `CONCURRENTLY` index are all unchanged. What changes is what a row means and what the
> aggregate may be used for.

## Considered Options

**Keeping Install byte-only, leaving MCP Servers permanently at 0.** Rejected because it quietly
defeats the one-catalog decision: with `sort_by=installs` as the default, every MCP Server would
sit below every Skill in the default listing forever, and a browse surface that structurally
buries a third of its contents is not one catalog.

**Keeping the default sort at `installs` while broadening what counts.** Rejected as the worse
half-measure. A number meaning "bytes moved" for two Kinds and "someone clicked reveal" for a
third should not be the thing ordering a mixed list by default. Broadening the event without
demoting the sort would make the incomparability invisible at exactly the moment it matters.

**A separate countable per Kind** — Downloads for Skills, Adds for MCP Servers, each with its own
column and its own sort option. Rejected: three leaderboards for one catalog, and the interface
would have to explain which one it is showing before showing anything.

## Consequences

**The counts are not comparable across Kinds, and the interface must not imply that they are.**
A Skill's count is a byte transfer someone actually completed. An MCP Server's is a CLI write, or
a click on "show me the config" — softer evidence, and inflatable by anyone who clicks twice.
`installs` remains a single field on every Resource, so a mixed list can show it, but ranking
Kinds against each other on it is a comparison this model does not support.

The web-side Install for an MCP Server needs a deliberate endpoint, because there is no byte
transfer for the API to notice — revealing or copying the config is a client-side act. That
endpoint is the first place a client can inflate a count directly, which the download path never
allowed: `recordInstall` was internal precisely so nothing could. The write stays best-effort in
the same way — a failure is logged and swallowed, never allowed to fail the user's action.

`sort_by` still accepts `installs`, so a reader who wants the most-installed Skills can ask for
them, ideally alongside `kind=skill`. Only the default moves.

Registry-wide stats (`GET /resources/stats`) sum Installs across every Kind. That total is the
one place the incomparability is already baked in and unavoidable; it is a volume-of-activity
number, not a popularity measure, and should be labelled as such.
