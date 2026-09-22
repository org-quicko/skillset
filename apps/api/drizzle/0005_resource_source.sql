-- Where a Resource came from (ADR-0041).
--
-- Nullable, and null is not "unknown": it is "published straight to this
-- Registry". Only an Import has an origin worth recording as data — the
-- Registry's own identity is configuration (PUBLIC_URL), so writing it into
-- every row would duplicate config into data and go stale the day the
-- deployment moves. The read resolves null to this Registry's reverse-DNS
-- domain instead, which is also why the rows already here need no backfill.
--
-- A column rather than a key in `payload`: every Kind comes from somewhere,
-- so this is Resource-level the same way `name` and `description` are, not
-- part of any one Kind's shape (ADR-0026).
--
-- The view is dropped and recreated to select it. Everything else here is
-- verbatim from 0004_directory_allowed_tools.sql, which stays the definition
-- of record for the rest of it.

ALTER TABLE "__db_schema__"."resources" ADD COLUMN "source" text;
--> statement-breakpoint
DROP VIEW "__db_schema__"."resource_directory";
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
    "r"."source",
    "r"."payload"->>'allowed_tools' AS "allowed_tools",
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
