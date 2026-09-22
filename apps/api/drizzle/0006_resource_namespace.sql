-- Which party named a Resource (ADR-0042).
--
-- `NOT NULL`, and every row carries a real value: `owner/repo` for anything
-- Imported out of a repository, and this deployment's own host for anything
-- published straight here. Nothing resolves a Namespace on read, which is what
-- separates it from `source` (0005): a Source is provenance and may genuinely
-- be absent, where a Namespace is half of a Resource's identity and never is.
--
-- The host arrives through `__registry_namespace__`, substituted by
-- `runMigrations` the same way the schema sentinel is, because `PUBLIC_URL` is
-- not known when this file is written and every pre-existing row needs a value
-- before the column can be `NOT NULL`. The value is checked against
-- `isNamespace` before substitution — see `schemaName.ts`.
--
-- The Import backfill derives from the `source` URL 0005 added, which is the
-- only reason no row here needs a human. It takes the last two path segments,
-- because GitLab's nested groups do not fit in the one slash a Namespace
-- allows: `group/subgroup/project` becomes `subgroup/project`. A trailing
-- `.git` and any trailing slash are stripped first, in their own
-- `regexp_replace`: folding that into the capture as an optional group looks
-- like it works and does not — Postgres prefers the longer capture and leaves
-- `owner/repo.git` behind. `importNamespace` in @in-org-quicko/skillset-shared
-- derives the same value for new Imports, and the two must not drift.
--
-- Splitting rows across Namespaces cannot introduce a conflict: the old
-- constraint already held (kind, name) unique, so the new one only ever
-- relaxes it.
--
-- The view is dropped and recreated to select the column. Everything else here
-- is verbatim from 0005_resource_source.sql, which stays the definition of
-- record for the rest of it.

ALTER TABLE "__db_schema__"."resources" ADD COLUMN "namespace" text;
--> statement-breakpoint
UPDATE "__db_schema__"."resources"
  SET "namespace" = lower(substring(regexp_replace("source", '(\.git)?/*$', '') from '([^/]+/[^/]+)$'))
  WHERE "source" IS NOT NULL
    AND "source" ~ '^https?://'
    AND substring(regexp_replace("source", '(\.git)?/*$', '') from '([^/]+/[^/]+)$') IS NOT NULL;
--> statement-breakpoint
UPDATE "__db_schema__"."resources" SET "namespace" = '__registry_namespace__' WHERE "namespace" IS NULL;
--> statement-breakpoint
ALTER TABLE "__db_schema__"."resources" ALTER COLUMN "namespace" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "__db_schema__"."resources" DROP CONSTRAINT "resources_kind_name_unique";
--> statement-breakpoint
ALTER TABLE "__db_schema__"."resources" ADD CONSTRAINT "resources_kind_namespace_name_unique" UNIQUE("kind","namespace","name");
--> statement-breakpoint
DROP VIEW "__db_schema__"."resource_directory";
--> statement-breakpoint
CREATE VIEW "__db_schema__"."resource_directory" AS
  SELECT
    "r"."id",
    "r"."kind",
    "r"."namespace",
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
