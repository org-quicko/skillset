-- Weighted full-text search, folding in `body` (see src/db/schemas/resource.ts).
--
-- A generated column's expression cannot be altered in place, so the column is
-- dropped and re-added. `resource_directory` selects it, so the view has to go
-- first and come back after — recreated verbatim from 0001_views.sql, which
-- stays the definition of record for everything else about it.
--
-- Dropping the column takes `resources_search_idx` with it; it is recreated
-- below rather than left to the next `db:generate`.

DROP VIEW "__db_schema__"."resource_directory";
--> statement-breakpoint
ALTER TABLE "__db_schema__"."resources" DROP COLUMN "search";
--> statement-breakpoint
ALTER TABLE "__db_schema__"."resources" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', name), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B') || setweight(to_tsvector('english', coalesce(body, '')), 'C') || setweight(to_tsvector('english', published_by_name), 'D')) STORED;
--> statement-breakpoint
CREATE INDEX "resources_search_idx" ON "__db_schema__"."resources" USING gin ("search");
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
