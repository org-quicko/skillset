-- `skills` becomes `resources`: one table for every Kind the Registry holds
-- (ADR-0026), `skill` being the only one registered so far. Existing rows are
-- carried across by rename rather than drop-and-recreate, and backfilled with
-- `kind = 'skill'` and a `payload` built from the four columns it replaces.
--
-- The two views are dropped and recreated rather than altered in place —
-- Postgres has no `ALTER VIEW` that can add a column or repoint a
-- materialized view's underlying table, so this is the same drop-and-recreate
-- 0001_views.sql used to create them, not a special case.
DROP VIEW IF EXISTS "skill_directory";
--> statement-breakpoint
DROP MATERIALIZED VIEW IF EXISTS "skill_analytics";
--> statement-breakpoint
ALTER TABLE "skills" RENAME TO "resources";
--> statement-breakpoint
ALTER TABLE "skill_tags" RENAME TO "resource_tags";
--> statement-breakpoint
ALTER TABLE "resource_tags" RENAME COLUMN "skill_id" TO "resource_id";
--> statement-breakpoint
ALTER TABLE "skill_install_events" RENAME TO "resource_install_events";
--> statement-breakpoint
ALTER TABLE "resource_install_events" RENAME COLUMN "skill_id" TO "resource_id";
--> statement-breakpoint
-- `kind`: every existing row is a Skill.
ALTER TABLE "resources" ADD COLUMN "kind" text;
--> statement-breakpoint
UPDATE "resources" SET "kind" = 'skill';
--> statement-breakpoint
ALTER TABLE "resources" ALTER COLUMN "kind" SET NOT NULL;
--> statement-breakpoint
-- `payload`: the four optional Agent Skills spec fields, moved off their own
-- columns (ADR-0026). `jsonb_build_object` keeps an unset field as JSON
-- `null` rather than dropping the key, matching the flat columns' own
-- nullable-but-always-selected shape.
ALTER TABLE "resources" ADD COLUMN "payload" jsonb;
--> statement-breakpoint
UPDATE "resources" SET "payload" = jsonb_build_object(
  'kind', 'skill',
  'license', "license",
  'compatibility', "compatibility",
  'metadata', "metadata",
  'allowed_tools', "allowed_tools"
);
--> statement-breakpoint
ALTER TABLE "resources" ALTER COLUMN "payload" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "resources" DROP COLUMN "license";
--> statement-breakpoint
ALTER TABLE "resources" DROP COLUMN "compatibility";
--> statement-breakpoint
ALTER TABLE "resources" DROP COLUMN "metadata";
--> statement-breakpoint
ALTER TABLE "resources" DROP COLUMN "allowed_tools";
--> statement-breakpoint
-- `body` is nullable now: not every future Kind supplies one (ADR-0026).
ALTER TABLE "resources" ALTER COLUMN "body" DROP NOT NULL;
--> statement-breakpoint
-- No single pattern fits every Kind, so `name` validation moves entirely to
-- the shared per-Kind validators (ADR-0026).
ALTER TABLE "resources" DROP CONSTRAINT IF EXISTS "skills_name_format";
--> statement-breakpoint
-- Publishing identity becomes (kind, name): an MCP Server and a Skill may
-- share a name (ADR-0026).
ALTER TABLE "resources" DROP CONSTRAINT IF EXISTS "skills_name_unique";
--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_kind_name_unique" UNIQUE ("kind", "name");
--> statement-breakpoint
-- Renamed to match the table, so a future `drizzle-kit generate` diffs
-- against names it actually expects.
ALTER TABLE "resources" RENAME CONSTRAINT "skills_published_by_users_id_fk" TO "resources_published_by_users_id_fk";
--> statement-breakpoint
ALTER INDEX "skills_search_idx" RENAME TO "resources_search_idx";
--> statement-breakpoint
-- The new default sort is `updated_at`, not `installs` (ADR-0028); nothing
-- reads by `published_at` order any more.
DROP INDEX IF EXISTS "skills_published_at_idx";
--> statement-breakpoint
CREATE INDEX "resources_updated_at_idx" ON "resources" USING btree ("updated_at" DESC NULLS LAST);
--> statement-breakpoint
ALTER TABLE "resource_tags" RENAME CONSTRAINT "skill_tags_skill_id_tag_id_pk" TO "resource_tags_resource_id_tag_id_pk";
--> statement-breakpoint
ALTER TABLE "resource_tags" RENAME CONSTRAINT "skill_tags_skill_id_skills_id_fk" TO "resource_tags_resource_id_resources_id_fk";
--> statement-breakpoint
ALTER TABLE "resource_tags" RENAME CONSTRAINT "skill_tags_tag_id_tags_id_fk" TO "resource_tags_tag_id_tags_id_fk";
--> statement-breakpoint
ALTER INDEX "skill_tags_tag_id_idx" RENAME TO "resource_tags_tag_id_idx";
--> statement-breakpoint
ALTER TABLE "resource_install_events" RENAME CONSTRAINT "skill_install_events_skill_id_skills_id_fk" TO "resource_install_events_resource_id_resources_id_fk";
--> statement-breakpoint
ALTER INDEX "skill_install_events_skill_id_idx" RENAME TO "resource_install_events_resource_id_idx";
--> statement-breakpoint
CREATE MATERIALIZED VIEW "resource_analytics" AS
  SELECT "resource_id", count(*)::integer AS "install_count"
  FROM "resource_install_events"
  GROUP BY "resource_id";
--> statement-breakpoint
CREATE VIEW "resource_directory" AS
  SELECT
    "r"."id",
    "r"."kind",
    "r"."name",
    "r"."description",
    "r"."published_by_name",
    "r"."updated_at",
    "r"."search",
    COALESCE("ra"."install_count", 0) AS "install_count",
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object('id', "t"."id", 'name', "t"."name") ORDER BY "t"."name")
        FROM "resource_tags" "rt"
        JOIN "tags" "t" ON "t"."id" = "rt"."tag_id"
        WHERE "rt"."resource_id" = "r"."id"
      ),
      '[]'::jsonb
    ) AS "tags"
  FROM "resources" "r"
  LEFT JOIN "resource_analytics" "ra" ON "ra"."resource_id" = "r"."id";
