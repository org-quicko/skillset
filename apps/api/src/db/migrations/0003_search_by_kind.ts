import { sql, type Kysely } from "kysely";

/**
 * Makes what a search matches depend on the Resource's Kind.
 *
 * @remarks
 * - Skill: name (A), description (B), body (C), publisher (D), as before.
 * - MCP Server: name (A), description (B), README (C). Not the publisher.
 * - Plugin: name (A) only.
 *
 * Postgres 14, the oldest this Registry supports, cannot change a generated
 * column's expression in place (`SET EXPRESSION` arrived in 17), so the column
 * is dropped and added again. `resource_directory` selects it, so the view is
 * dropped first and recreated unchanged from the baseline afterwards. Dropping
 * the column drops its index, which is created again too.
 */
export async function up(db: Kysely<unknown>, schema: string): Promise<void> {
  const qualified = (name: string) => sql.id(schema, name);

  await db.schema.dropView("resource_directory").execute();
  await db.schema.alterTable("resources").dropColumn("search").execute();

  const name = sql`setweight(to_tsvector('english', name), 'A')`;
  const description = sql`setweight(to_tsvector('english', coalesce(description, '')), 'B')`;
  const body = sql`setweight(to_tsvector('english', coalesce(body, '')), 'C')`;
  const publisher = sql`setweight(to_tsvector('english', published_by_name), 'D')`;
  await db.schema
    .alterTable("resources")
    .addColumn("search", sql`tsvector`, (col) =>
      col
        .generatedAlwaysAs(
          sql`CASE kind
            WHEN 'plugin' THEN ${name}
            WHEN 'mcp' THEN ${name} || ${description} || ${body}
            ELSE ${name} || ${description} || ${body} || ${publisher}
          END`,
        )
        .stored(),
    )
    .execute();
  await db.schema.createIndex("resources_search_idx").on("resources").using("gin").column("search").execute();

  await db.schema
    .createView("resource_directory")
    .as(
      sql`
        SELECT
          r.id,
          r.kind,
          r.namespace,
          r.name,
          r.description,
          r.published_by_name,
          r.updated_at,
          r.search,
          r.source,
          r.payload->>'allowed_tools' AS allowed_tools,
          COALESCE(ra.install_count, 0) AS install_count,
          COALESCE(
            (
              SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) ORDER BY t.name)
              FROM ${qualified("resource_tags")} rt
              JOIN ${qualified("tags")} t ON t.id = rt.tag_id
              WHERE rt.resource_id = r.id
            ),
            '[]'::jsonb
          ) AS tags
        FROM ${qualified("resources")} r
        LEFT JOIN ${qualified("resource_analytics")} ra ON ra.resource_id = r.id
      `,
    )
    .execute();
}
