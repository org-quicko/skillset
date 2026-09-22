-- `allowed-tools` on the directory read model, so the Resource list answers
-- what tool access a Skill claims before anyone installs it.
--
-- It lives in `payload` (ADR-0026) rather than as a column, so it is read out
-- with `->>`: jsonb's text accessor already yields NULL for both a missing key
-- and a JSON null, which is exactly the "the frontmatter never set it" the
-- detail read reports.
--
-- A view's column list cannot be extended in place, so the view is dropped and
-- recreated. Everything else here is verbatim from 0002_search_weights.sql,
-- which stays the definition of record for the rest of it.

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
