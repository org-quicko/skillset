-- Drizzle has no CREATE VIEW / CREATE MATERIALIZED VIEW generator, so both
-- views are declared `.existing()` in the schema (see
-- src/db/schemas/resource-analytics.ts and resource-directory.ts) and created
-- here by hand. resource_directory reads from resource_analytics, so the
-- order matters.
--
-- "__db_schema__" is the sentinel every generated migration carries in place
-- of a real schema name; runMigrations substitutes it (see
-- src/db/schemaName.ts). Hand-written SQL has to spell it out the same way,
-- because nothing qualifies these names for us.

CREATE MATERIALIZED VIEW "__db_schema__"."resource_analytics" AS
  SELECT "resource_id", count(*)::integer AS "install_count"
  FROM "__db_schema__"."resource_install_events"
  GROUP BY "resource_id";
--> statement-breakpoint
CREATE VIEW "__db_schema__"."resource_directory" AS
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
        FROM "__db_schema__"."resource_tags" "rt"
        JOIN "__db_schema__"."tags" "t" ON "t"."id" = "rt"."tag_id"
        WHERE "rt"."resource_id" = "r"."id"
      ),
      '[]'::jsonb
    ) AS "tags"
  FROM "__db_schema__"."resources" "r"
  LEFT JOIN "__db_schema__"."resource_analytics" "ra" ON "ra"."resource_id" = "r"."id";
