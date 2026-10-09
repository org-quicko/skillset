# Install Counts Are an Event Log with a Periodically Refreshed Materialized View, Not a Real-Time Counter

**Status:** supersedes the storage shape the skill-analytics spec (`.scratch/skill-analytics/spec.md`)
originally recorded — that spec explicitly ruled out an event log ("no counter, event, or table" beyond a
single running total). This ADR reverses that call before it shipped.

> **Amended by ADR-0028.** The log is `resource_install_events` and the view is
> `resource_analytics`. An Install now means something different per Kind, so counts are not
> comparable across Kinds and `updated_at` — not `installs` — is the catalog's default sort.
> The event-log-plus-materialized-view design below is otherwise unchanged.

A Skill's install count is derived from `skill_install_events` — one immutable row per Install (a web
Download today, a CLI `skillset install` later), distinguished by a `source` column — via a `skill_analytics`
materialized view refreshed on a schedule (`node-cron`, interval set by `ANALYTICS_REFRESH_CRON`), rather
than an atomic `install_count + 1` upsert on a live table read on every request. We chose this because a
raw log is the only shape that can support install history or per-source breakdowns later without a
migration, and it removes the concurrent-upsert path entirely — the trade-off is that every surface
showing an install count (a Skill's own page, the list, ticket #23's `installs`-sort) can lag reality by
up to the refresh interval, including a reader not seeing their own just-completed download reflected
immediately.

## Considered Options

The real-time atomic-upsert design (a single `skill_analytics` table, `install_count + 1` in the same
statement as the upsert) was the original design and was fully implemented before this reversal; it's
simpler and has no staleness window, but keeps no history and cannot answer "installs from the CLI vs.
the web" or "installs this week" without a schema change. `REFRESH MATERIALIZED VIEW CONCURRENTLY` was
considered over a plain refresh, to avoid blocking reads during the refresh; rejected for now as
complexity (an extra unique index, a more awkward first-refresh) this scale doesn't need yet — see the
refresh statement in `apps/api/src/features/analytics/analytics.service.ts` if that changes.

## Consequences

Every table in this schema otherwise carries a `created_at`/`updated_at` pair by convention;
`skill_install_events` deliberately omits `updated_at` since its rows are never touched after insert. The
materialized view is only ever recomputed by `refreshInstallCounts`, called both by the cron job and
directly by tests — nothing else may write to or refresh it. `ANALYTICS_REFRESH_CRON` is validated at
startup and the process refuses to start on an invalid expression, the same fail-fast treatment every
other required environment variable already gets in `config.ts`.
