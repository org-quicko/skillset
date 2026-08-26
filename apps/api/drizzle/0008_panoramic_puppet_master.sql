ALTER TABLE "skills" ADD COLUMN "published_by_name" text;--> statement-breakpoint
UPDATE "skills" SET "published_by_name" = COALESCE(
  (SELECT "u"."first_name" || ' ' || "u"."last_name" FROM "users" "u" WHERE "u"."id" = "skills"."published_by"),
  "skills"."published_by_email"
);--> statement-breakpoint
ALTER TABLE "skills" ALTER COLUMN "published_by_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" DROP COLUMN "search";--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', name || ' ' || coalesce(description, '') || ' ' || published_by_name)) STORED;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skills_search_idx" ON "skills" USING gin ("search");--> statement-breakpoint
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
