import { inArray } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { skillAnalytics, skillInstallEvents } from "../db/schema.js";
import type { Logger } from "../logger.js";

export interface AnalyticsServiceDependencies {
  db: Database;
  logger: Logger;
}

/** Where a recorded Install came from — see `skillInstallSourceEnum` (ADR-0012). */
export type InstallSource = "web" | "cli";

/**
 * Records one Install of a Skill — a Download of its Artifact today, and
 * eventually a `skillreg add` too (ticket 09 would call this same function
 * with `source: "cli"`).
 *
 * @remarks
 * Best-effort by design (spec: `.scratch/skill-analytics/spec.md`): a
 * bookkeeping failure here must never stand between a reader and the Skill
 * they came for, so every failure is caught and logged rather than thrown.
 * This only appends the event (ADR-0012) — it does not touch
 * `skill_analytics`, which reflects it once `refreshInstallCounts` next
 * runs.
 *
 * @param deps - The database and logger this needs.
 * @param skillId - The Skill's id.
 * @param source - Where this Install came from.
 * @example
 * ```ts
 * await recordInstall(deps, skillId, "web");
 * ```
 */
export async function recordInstall(
  deps: AnalyticsServiceDependencies,
  skillId: string,
  source: InstallSource,
): Promise<void> {
  try {
    await deps.db.insert(skillInstallEvents).values({ skill_id: skillId, source });
  } catch (cause) {
    deps.logger.error({ err: cause, skill_id: skillId, source }, "failed to record install");
  }
}

/**
 * Recomputes `skill_analytics` from the current `skill_install_events` log.
 *
 * @remarks
 * The only thing that may write to `skill_analytics` (ADR-0012) — called on
 * every tick of the `ANALYTICS_REFRESH_CRON` schedule (see `server.ts`), and
 * directly by tests that need a deterministic point to assert a count from,
 * rather than waiting on that schedule. A plain `REFRESH MATERIALIZED VIEW`,
 * not `CONCURRENTLY`: it takes an exclusive lock on the view for the
 * duration, which at this scale is expected to complete in milliseconds.
 *
 * @param deps - The database this refreshes.
 * @example
 * ```ts
 * await refreshInstallCounts(deps);
 * ```
 */
export async function refreshInstallCounts(deps: Pick<AnalyticsServiceDependencies, "db">): Promise<void> {
  await deps.db.refreshMaterializedView(skillAnalytics);
}

/**
 * Fetches install counts for a set of Skills, keyed by Skill id, as of the
 * last `refreshInstallCounts`.
 *
 * @remarks
 * One query for however many Skill ids are passed, not one per Skill —
 * mirrors `getTagsBySkillIds` in `./tags.js`. A Skill id with no recorded
 * Install is simply absent from the map; callers should default to `0`.
 *
 * @param deps - The database this reads from.
 * @param skillIds - The Skill ids to fetch install counts for. An empty
 * array short-circuits to an empty map without a query.
 * @returns A map from Skill id to its install count.
 * @example
 * ```ts
 * const counts = await getInstallCountsBySkillIds(deps, [id1, id2]);
 * const installsForId1 = counts.get(id1) ?? 0;
 * ```
 */
export async function getInstallCountsBySkillIds(
  deps: Pick<AnalyticsServiceDependencies, "db">,
  skillIds: string[],
): Promise<Map<string, number>> {
  if (skillIds.length === 0) return new Map();

  const rows = await deps.db
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
 * @param deps - The database this reads from.
 * @param skillId - The Skill's id.
 * @returns The Skill's install count — `0` if it has never been recorded.
 * @example
 * ```ts
 * const installs = await getInstallCount(deps, skillId);
 * ```
 */
export async function getInstallCount(deps: Pick<AnalyticsServiceDependencies, "db">, skillId: string): Promise<number> {
  const bySkill = await getInstallCountsBySkillIds(deps, [skillId]);
  return bySkill.get(skillId) ?? 0;
}
