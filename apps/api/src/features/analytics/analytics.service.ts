import { sql } from "kysely";
import type { Database } from "../../db/client.js";
import type { Logger } from "../../lib/logger.js";

/** Where a recorded Install came from — see `resourceInstallSourceEnum` (ADR-0012). */
export type InstallSource = "web" | "cli" | "mcp";

/** One day's Install count, as returned by `getInstallTimeseries`. */
export interface InstallTrendPoint {
  /** The day this point covers, as `YYYY-MM-DD`, UTC. */
  date: string;
  count: number;
}

/**
 * Install bookkeeping: appending Install events, and reading the counts back
 * off `resource_analytics` (ADR-0012, ADR-0028).
 */
export class AnalyticsService {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  /**
   * Records one Install of a Skill — a Download of its Artifact, whether
   * from the web interface, `skillset install`, or the MCP server, distinguished
   * by `source` (`"web"`, `"cli"`, or `"mcp"`).
   *
   * @remarks
   * Best-effort by design: a bookkeeping failure must never stand between a
   * reader and the Skill they came for, so failures are logged, not thrown.
   * Appends the event only (ADR-0012) — `skill_analytics` reflects it once
   * `refreshInstallCounts` next runs.
   *
   * At most one Install per client per Resource per day is kept, which is
   * what `on conflict do nothing` and the unique index on
   * `resource_install_events` do between them (ISSUE-23). The endpoint is
   * unauthenticated, so without that the count — and the catalog's
   * most-installed sort — was whatever anyone cared to make it. A repeat
   * within the day is silently not recorded rather than refused: the caller
   * is downloading a Skill, and being told off for downloading it twice would
   * be a strange answer to that.
   *
   * @param skillId - The Skill's id.
   * @param source - Where this Install came from.
   * @param clientFingerprint - The digest identifying the client, from
   * `installFingerprint`. Omitted or `undefined` records the Install without
   * deduplicating it.
   * @example
   * ```ts
   * await analytics.recordInstall(skillId, "web", fingerprint);
   * ```
   */
  async recordInstall(skillId: string, source: InstallSource, clientFingerprint?: string): Promise<void> {
    try {
      await this.db
        .insertInto("resource_install_events")
        .values({ resource_id: skillId, source, client_fingerprint: clientFingerprint ?? null })
        // No conflict target: the index it would name is on an expression, and
        // every unique constraint on this table is this one anyway.
        .onConflict((oc) => oc.doNothing())
        .execute();
    } catch (cause) {
      this.logger.error({ err: cause, skill_id: skillId, source }, "failed to record install");
    }
  }

  /**
   * Recomputes `resource_analytics` from the current
   * `resource_install_events` log.
   *
   * @remarks
   * The only writer of `resource_analytics` (ADR-0012). Called on every tick
   * of `ANALYTICS_REFRESH_CRON` (see `server.ts`), and directly by tests that
   * need a deterministic point to assert a count from.
   *
   * Not `CONCURRENTLY`: this takes an exclusive lock on the view, expected to
   * complete in milliseconds at this scale.
   */
  async refreshInstallCounts(): Promise<void> {
    await this.db.schema.refreshMaterializedView("resource_analytics").execute();
  }

  /**
   * Fetches install counts for a set of Skills, keyed by Skill id, as of the
   * last `refreshInstallCounts`.
   *
   * @remarks
   * One query for however many Skill ids are passed, not one per Skill —
   * mirrors `TagsService.getTagsBySkillIds`. A Skill id with no recorded
   * Install is simply absent from the map; callers should default to `0`.
   *
   * @param skillIds - The Skill ids to fetch install counts for. An empty
   * array short-circuits to an empty map without a query.
   * @returns A map from Skill id to its install count.
   * @example
   * ```ts
   * const counts = await analytics.getInstallCountsBySkillIds([id1, id2]);
   * const installsForId1 = counts.get(id1) ?? 0;
   * ```
   */
  async getInstallCountsBySkillIds(skillIds: string[]): Promise<Map<string, number>> {
    if (skillIds.length === 0) return new Map();

    const rows = await this.db
      .selectFrom("resource_analytics")
      .select(["resource_id", "install_count"])
      .where("resource_id", "in", skillIds)
      .execute();

    return new Map(rows.map((row) => [row.resource_id, row.install_count]));
  }

  /**
   * Fetches one Skill's install count, as of the last `refreshInstallCounts`.
   *
   * @remarks
   * The single-Skill counterpart to `getInstallCountsBySkillIds`, for the
   * read paths (`getSkill`, `getSkillByName`, `publishSkill`'s response) that
   * only ever need one Skill's count.
   *
   * @param skillId - The Skill's id.
   * @returns The Skill's install count — `0` if it has never been recorded.
   * @example
   * ```ts
   * const installs = await analytics.getInstallCount(skillId);
   * ```
   */
  async getInstallCount(skillId: string): Promise<number> {
    const bySkill = await this.getInstallCountsBySkillIds([skillId]);
    return bySkill.get(skillId) ?? 0;
  }

  /**
   * Sums install counts across every Skill, as of the last
   * `refreshInstallCounts` — the registry-wide counterpart to
   * `getInstallCount`, for the Skill directory's hero stats.
   *
   * @remarks
   * A Skill with no recorded Install has no row in `resource_analytics` and
   * simply contributes nothing to the sum, the same as it defaults to `0`
   * everywhere else (ADR-0012).
   *
   * @returns The total Install count across every Skill.
   * @example
   * ```ts
   * const totalInstalls = await analytics.getTotalInstallCount();
   * ```
   */
  async getTotalInstallCount(): Promise<number> {
    // `sum` of a bigint is a `numeric`, which pg returns as a string, and is
    // SQL NULL over zero rows — coalesced to 0 so an install-free Registry
    // gets a count, not a parse of `null`.
    const row = await this.db
      .selectFrom("resource_analytics")
      .select(sql<string>`coalesce(sum(${sql.ref("install_count")}), 0)`.as("total"))
      .executeTakeFirstOrThrow();
    return Number(row.total);
  }

  /**
   * Fetches one Resource's daily Install counts for the trailing `days` days
   * (today inclusive), zero-filled for days with no recorded Install.
   *
   * @remarks
   * `resource_analytics` only ever holds the running total (ADR-0012), so a
   * day-by-day breakdown has to come from `resource_install_events` — the
   * event log — directly, live rather than through that view. Bucketed by
   * UTC calendar day regardless of the caller's own timezone, so the same
   * request returns the same counts no matter which server answers it.
   * `generate_series` supplies the empty days; a plain `group by` would
   * silently drop them, leaving gaps in a trend chart.
   *
   * @param resourceId - The Resource's id.
   * @param days - How many trailing days to return, today inclusive.
   * @returns One point per day, oldest first.
   * @example
   * ```ts
   * const trend = await analytics.getInstallTimeseries(skillId, 30);
   * ```
   */
  async getInstallTimeseries(resourceId: string, days: number): Promise<InstallTrendPoint[]> {
    // `gs.day` is a `timestamp`: the series is built from dates stepped by an
    // interval. Returned as `::date::text` so `date` stays a `YYYY-MM-DD`
    // string rather than a JS `Date` pg would parse a bare `date` into.
    const rows = await this.db
      .selectFrom(
        this.db
          .selectNoFrom(
            sql<Date>`generate_series(
              (current_date - ${days - 1} * interval '1 day')::date,
              current_date::date,
              interval '1 day'
            )`.as("day"),
          )
          .as("gs"),
      )
      .leftJoin("resource_install_events as rie", (join) =>
        join
          .on("rie.resource_id", "=", resourceId)
          .onRef("rie.created_at", ">=", "gs.day")
          .on("rie.created_at", "<", sql<Date>`${sql.ref("gs.day")} + interval '1 day'`),
      )
      .select([
        sql<string>`${sql.ref("gs.day")}::date::text`.as("date"),
        sql<number>`coalesce(count(${sql.ref("rie.id")}), 0)::int`.as("count"),
      ])
      .groupBy("gs.day")
      .orderBy("gs.day")
      .execute();
    return rows.map((row) => ({ date: row.date, count: row.count }));
  }
}
