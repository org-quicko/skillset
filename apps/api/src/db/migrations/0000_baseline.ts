import { sql, type Kysely } from "kysely";

/**
 * The whole schema as it stood when the Registry moved to Kysely (ADR-0045).
 *
 * @remarks
 * Tables, constraints, and indexes are qualified by the client's `withSchema`.
 * The three things it cannot reach name `schema` themselves: a column typed by
 * one of the enums, and the two views, whose bodies are raw SQL.
 *
 * Constraint and index names are the ones the Registry has always used, so
 * nothing that reports or matches on one changes.
 */
export async function up(db: Kysely<unknown>, schema: string): Promise<void> {
  const qualified = (name: string) => sql.id(schema, name);
  const uuidv7 = sql`uuidv7()`;
  const now = sql`now()`;

  // An extension installs into the first schema on the search_path, which is
  // `public` whatever DB_SCHEMA names, so `word_similarity()` resolves from any
  // schema (ADR-0040). `IF NOT EXISTS` lets a DBA pre-create it for a role that
  // cannot — see README, "Fuzzy search".
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(db);

  await db.schema.createType("user_role").asEnum(["reader", "writer", "admin", "superadmin"]).execute();
  await db.schema.createType("identity_provider_kind").asEnum(["google", "microsoft", "github"]).execute();
  await db.schema.createType("skill_install_source").asEnum(["web", "cli", "mcp"]).execute();

  // Better Auth's models (ADR-0016) — see ./README.md before changing them.
  await db.schema
    .createTable("users")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(uuidv7))
    .addColumn("email", "text", (col) => col.notNull())
    .addColumn("first_name", "text", (col) => col.notNull())
    .addColumn("last_name", "text", (col) => col.notNull())
    .addColumn("name", "text", (col) => col.notNull().generatedAlwaysAs(sql`first_name || ' ' || last_name`).stored())
    .addColumn("email_verified", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("image", "text")
    .addColumn("role", qualified("user_role"), (col) => col.notNull())
    .addColumn("must_change_password", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addUniqueConstraint("users_email_unique", ["email"])
    .execute();
  // At most one Superadmin, enforced where the row is written.
  await db.schema
    .createIndex("users_role_superadmin_index")
    .on("users")
    .unique()
    .column("role")
    .where(sql.ref("role"), "=", "superadmin")
    .execute();

  await db.schema
    .createTable("accounts")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(uuidv7))
    .addColumn("account_id", "text", (col) => col.notNull())
    .addColumn("provider_id", "text", (col) => col.notNull())
    .addColumn("user_id", "uuid", (col) => col.notNull())
    .addColumn("password", "text")
    .addColumn("access_token", "text")
    .addColumn("refresh_token", "text")
    .addColumn("id_token", "text")
    .addColumn("access_token_expires_at", "timestamptz")
    .addColumn("refresh_token_expires_at", "timestamptz")
    .addColumn("scope", "text")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addForeignKeyConstraint("accounts_user_id_users_id_fk", ["user_id"], "users", ["id"], (fk) =>
      fk.onDelete("cascade"),
    )
    .execute();
  await db.schema.createIndex("accounts_user_id_idx").on("accounts").column("user_id").execute();
  await db.schema
    .createIndex("accounts_provider_account_idx")
    .on("accounts")
    .unique()
    .columns(["provider_id", "account_id"])
    .execute();

  await db.schema
    .createTable("sessions")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(uuidv7))
    .addColumn("token", "text", (col) => col.notNull())
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .addColumn("ip_address", "text")
    .addColumn("user_agent", "text")
    .addColumn("user_id", "uuid", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addUniqueConstraint("sessions_token_unique", ["token"])
    .addForeignKeyConstraint("sessions_user_id_users_id_fk", ["user_id"], "users", ["id"], (fk) =>
      fk.onDelete("cascade"),
    )
    .execute();
  await db.schema.createIndex("sessions_user_id_idx").on("sessions").column("user_id").execute();

  await db.schema
    .createTable("verifications")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(uuidv7))
    .addColumn("identifier", "text", (col) => col.notNull())
    .addColumn("value", "text", (col) => col.notNull())
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .execute();
  await db.schema.createIndex("verifications_identifier_idx").on("verifications").column("identifier").execute();

  // Counted in Postgres rather than in process memory (ISSUE-7).
  await db.schema
    .createTable("rate_limits")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(uuidv7))
    .addColumn("key", "text", (col) => col.notNull())
    .addColumn("count", "integer", (col) => col.notNull())
    .addColumn("last_request", "bigint", (col) => col.notNull())
    .addUniqueConstraint("rate_limits_key_unique", ["key"])
    .execute();

  await db.schema
    .createTable("identity_providers")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(uuidv7))
    .addColumn("kind", qualified("identity_provider_kind"), (col) => col.notNull())
    .addColumn("display_name", "text", (col) => col.notNull())
    .addColumn("client_id", "text", (col) => col.notNull())
    .addColumn("client_secret", "text", (col) => col.notNull())
    .addColumn("permitted_organisations", sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'::text[]`))
    .addColumn("enabled", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addUniqueConstraint("identity_providers_kind_unique", ["kind"])
    .execute();

  await db.schema
    .createTable("integrations")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(uuidv7))
    .addColumn("provider", "text", (col) => col.notNull())
    .addColumn("display_name", "text", (col) => col.notNull())
    .addColumn("description", "text")
    .addColumn("client_id", "text", (col) => col.notNull())
    .addColumn("client_secret", "text", (col) => col.notNull())
    .addColumn("app_slug", "text")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .execute();

  await db.schema
    .createTable("connections")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(uuidv7))
    .addColumn("user_id", "uuid", (col) => col.notNull())
    .addColumn("provider", "text", (col) => col.notNull())
    .addColumn("integration_id", "uuid", (col) => col.notNull())
    .addColumn("external_account_id", "text", (col) => col.notNull())
    .addColumn("external_account_login", "text", (col) => col.notNull())
    .addColumn("access_token", "text", (col) => col.notNull())
    .addColumn("refresh_token", "text")
    .addColumn("expires_at", "timestamptz")
    .addColumn("refresh_token_expires_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addUniqueConstraint("connections_user_id_provider_key", ["user_id", "provider"])
    .addForeignKeyConstraint("connections_user_id_users_id_fk", ["user_id"], "users", ["id"], (fk) =>
      fk.onDelete("cascade"),
    )
    // Restrict, so an Integration still backing a Connection cannot be deleted.
    .addForeignKeyConstraint("connections_integration_id_integrations_id_fk", ["integration_id"], "integrations", ["id"], (fk) =>
      fk.onDelete("restrict"),
    )
    .execute();

  await db.schema
    .createTable("tokens")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(uuidv7))
    .addColumn("user_id", "uuid", (col) => col.notNull())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("token_hash", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addColumn("last_used_at", "timestamptz")
    .addForeignKeyConstraint("tokens_user_id_users_id_fk", ["user_id"], "users", ["id"], (fk) => fk.onDelete("cascade"))
    .execute();
  await db.schema.createIndex("tokens_token_hash_idx").on("tokens").unique().column("token_hash").execute();
  await db.schema.createIndex("tokens_user_id_idx").on("tokens").column("user_id").execute();

  // `namespace` and `name` are identity (ADR-0042); `source` is provenance, and
  // null means "published straight to this Registry" (ADR-0041).
  await db.schema
    .createTable("resources")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(uuidv7))
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("namespace", "text", (col) => col.notNull())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("description", "text", (col) => col.notNull())
    .addColumn("body", "text")
    .addColumn("payload", "jsonb", (col) => col.notNull())
    .addColumn("source", "text")
    .addColumn("published_by", "uuid")
    .addColumn("published_by_email", "text", (col) => col.notNull())
    .addColumn("published_by_name", "text", (col) => col.notNull())
    .addColumn("published_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addColumn("search", sql`tsvector`, (col) =>
      col
        .generatedAlwaysAs(
          sql`setweight(to_tsvector('english', name), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B') || setweight(to_tsvector('english', coalesce(body, '')), 'C') || setweight(to_tsvector('english', published_by_name), 'D')`,
        )
        .stored(),
    )
    .addUniqueConstraint("resources_kind_namespace_name_unique", ["kind", "namespace", "name"])
    .addForeignKeyConstraint("resources_published_by_users_id_fk", ["published_by"], "users", ["id"], (fk) =>
      fk.onDelete("set null"),
    )
    .execute();
  await db.schema.createIndex("resources_search_idx").on("resources").using("gin").column("search").execute();
  await db.schema
    .createIndex("resources_updated_at_idx")
    .on("resources")
    .expression(sql`updated_at DESC NULLS LAST`)
    .execute();

  await db.schema
    .createTable("resource_install_events")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(uuidv7))
    .addColumn("resource_id", "uuid", (col) => col.notNull())
    .addColumn("source", qualified("skill_install_source"), (col) => col.notNull())
    .addColumn("client_fingerprint", "text")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addForeignKeyConstraint(
      "resource_install_events_resource_id_resources_id_fk",
      ["resource_id"],
      "resources",
      ["id"],
      (fk) => fk.onDelete("cascade"),
    )
    .execute();
  await db.schema
    .createIndex("resource_install_events_resource_id_idx")
    .on("resource_install_events")
    .column("resource_id")
    .execute();
  // One install per client per Resource per UTC day (ADR-0012).
  await db.schema
    .createIndex("resource_install_events_dedupe_idx")
    .on("resource_install_events")
    .unique()
    .expression(sql`resource_id, client_fingerprint, ((created_at AT TIME ZONE 'UTC')::date)`)
    .execute();

  // `name` arrives normalised by the shared `validateTagName`; the check is the
  // same rule, enforced where the row is written (ADR-0011).
  await db.schema
    .createTable("tags")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(uuidv7))
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addUniqueConstraint("tags_name_unique", ["name"])
    .addCheckConstraint("tags_name_format", sql`name ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(name) <= 32`)
    .execute();

  await db.schema
    .createTable("resource_tags")
    .addColumn("resource_id", "uuid", (col) => col.notNull())
    .addColumn("tag_id", "uuid", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addPrimaryKeyConstraint("resource_tags_resource_id_tag_id_pk", ["resource_id", "tag_id"])
    .addForeignKeyConstraint("resource_tags_resource_id_resources_id_fk", ["resource_id"], "resources", ["id"], (fk) =>
      fk.onDelete("cascade"),
    )
    .addForeignKeyConstraint("resource_tags_tag_id_tags_id_fk", ["tag_id"], "tags", ["id"], (fk) =>
      fk.onDelete("cascade"),
    )
    .execute();
  await db.schema.createIndex("resource_tags_tag_id_idx").on("resource_tags").column("tag_id").execute();

  // Kept apart from `resources` so no catalog read can reach an unapproved row;
  // shaped like it so approving is a column-for-column copy (ADR-0044).
  await db.schema
    .createTable("resource_submissions")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(uuidv7))
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("namespace", "text", (col) => col.notNull())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("description", "text", (col) => col.notNull())
    .addColumn("body", "text")
    .addColumn("payload", "jsonb", (col) => col.notNull())
    .addColumn("source", "text", (col) => col.notNull())
    .addColumn("submitted_by", "uuid")
    .addColumn("submitted_by_email", "text", (col) => col.notNull())
    .addColumn("submitted_by_name", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(now))
    .addUniqueConstraint("resource_submissions_kind_namespace_name_unique", ["kind", "namespace", "name"])
    .addForeignKeyConstraint("resource_submissions_submitted_by_users_id_fk", ["submitted_by"], "users", ["id"], (fk) =>
      fk.onDelete("set null"),
    )
    .execute();
  await db.schema
    .createIndex("resource_submissions_created_at_idx")
    .on("resource_submissions")
    .expression(sql`created_at DESC NULLS LAST`)
    .execute();

  // Refreshed on a schedule rather than counted per read (ADR-0012).
  await db.schema
    .createView("resource_analytics")
    .materialized()
    .as(
      sql`SELECT resource_id, count(*)::integer AS install_count FROM ${qualified("resource_install_events")} GROUP BY resource_id`,
    )
    .execute();

  // The catalog's read model. `allowed_tools` is read out of `payload`, where a
  // Skill's frontmatter keeps it (ADR-0026); `->>` yields NULL for a missing key
  // and a JSON null alike.
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
