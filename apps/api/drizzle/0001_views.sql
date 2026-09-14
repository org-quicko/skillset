-- Drizzle has no CREATE VIEW / CREATE MATERIALIZED VIEW generator, so both
-- views are declared `.existing()` in the schema (see
-- src/db/schemas/skill-analytics.ts and skill-directory.ts) and created here by
-- hand. skill_directory reads from skill_analytics, so the order matters.

CREATE MATERIALIZED VIEW IF NOT EXISTS "skill_analytics" AS
  SELECT "skill_id", count(*)::integer AS "install_count"
  FROM "skill_install_events"
  GROUP BY "skill_id";
--> statement-breakpoint
CREATE OR REPLACE VIEW "skill_directory" AS
  SELECT
    "s"."id",
    "s"."name",
    "s"."description",
    "s"."published_by_name",
    "s"."updated_at",
    "s"."search",
    COALESCE("sa"."install_count", 0) AS "install_count",
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object('id', "t"."id", 'name', "t"."name") ORDER BY "t"."name")
        FROM "skill_tags" "st"
        JOIN "tags" "t" ON "t"."id" = "st"."tag_id"
        WHERE "st"."skill_id" = "s"."id"
      ),
      '[]'::jsonb
    ) AS "tags"
  FROM "skills" "s"
  LEFT JOIN "skill_analytics" "sa" ON "sa"."skill_id" = "s"."id";
