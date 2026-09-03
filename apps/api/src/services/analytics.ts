import { inArray, sql, sum } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { skillAnalytics, skillInstallEvents } from "../db/schemas/index.js";
import type { Logger } from "../logger.js";

/** Where a recorded Install came from — see `skillInstallSourceEnum` (ADR-0012). */
export type InstallSource = "web" | "cli";

/**
 * Install bookkeeping: appending Install events, and reading the counts back
 * off `skill_analytics` (ADR-0012).
 */
export class AnalyticsService {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  /**
   * Records one Install of a Skill — a Download of its Artifact today, and
   * eventually a `skillreg add` too (ticket 09 would call this same method
   * with `source: "cli"`).
   *
   * @remarks
   * Best-effort by design: a bookkeeping failure must never stand between a
   * reader and the Skill they came for, so failures are logged, not thrown.
   * Appends the event only (ADR-0012) — `skill_analytics` reflects it once
   * `refreshInstallCounts` next runs.
   *
   * @param skillId - The Skill's id.
   * @param source - Where this Install came from.
   * @example
   * ```ts
   * await analytics.recordInstall(skillId, "web");
   * ```
   */
  async recordInstall(skillId: string, source: InstallSource): Promise<void> {
    try {
      await this.db.insert(skillInstallEvents).values({ skill_id: skillId, source });
    } catch (cause) {
      this.logger.error({ err: cause, skill_id: skillId, source }, "failed to record install");
    }
  }

  /**
   * Recomputes `skill_analytics` from the current `skill_install_events` log.
   *
   * @remarks
   * The only writer of `skill_analytics` (ADR-0012). Called on every tick of
   * `ANALYTICS_REFRESH_CRON` (see `server.ts`), and directly by tests that
   * need a deterministic point to assert a count from.
   *
   * Not `CONCURRENTLY`: this takes an exclusive lock on the view, expected to
   * complete in milliseconds at this scale.
   */
  async refreshInstallCounts(): Promise<void> {
    await this.db.refreshMaterializedView(skillAnalytics);
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
      .select({ skill_id: skillAnalytics.skill_id, install_count: skillAnalytics.install_count })
      .from(skillAnalytics)
      .where(inArray(skillAnalytics.skill_id, skillIds));

    return new Map(rows.map((row) => [row.skill_id, row.install_count]));
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
   * A Skill with no recorded Install has no row in `skill_analytics` and
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
    // `sum` maps to `string` (a bigint total could exceed safe integer range
    // in principle) and reads SQL NULL over zero rows — coalesced back to
    // `'0'` so an install-free Registry gets a count, not a parse of `null`.
    const [row] = await this.db
      .select({ total: sql<string>`coalesce(${sum(skillAnalytics.install_count)}, '0')` })
      .from(skillAnalytics);
    return Number(row?.total ?? 0);
  }
}
