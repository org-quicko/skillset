import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "kysely";
import { createDatabase, type Database } from "./client.js";
import { runMigrations } from "./migrate.js";
import { migrations } from "./migrations/index.js";

// Not public, so a statement that forgot its schema cannot pass by accident.
const SCHEMA = "registry";

async function relationsIn(db: Database, schema: string): Promise<string[]> {
  const { rows } = await sql<{ name: string }>`
    SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${schema} AND c.relkind IN ('r', 'v', 'm', 'i') ORDER BY c.relname
  `.execute(db);
  return rows.map((row) => row.name);
}

async function typesIn(db: Database, schema: string): Promise<string[]> {
  const { rows } = await sql<{ name: string }>`
    SELECT t.typname AS name FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = ${schema} AND t.typtype = 'e' ORDER BY t.typname
  `.execute(db);
  return rows.map((row) => row.name);
}

describe("runMigrations", () => {
  let container: StartedPostgreSqlContainer;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:18-alpine").start();
    ({ db, close } = createDatabase(container.getConnectionUri(), SCHEMA));
    await runMigrations(db, SCHEMA);
  }, 60_000);

  afterAll(async () => {
    await close();
    await container.stop();
  });

  it("records every migration in the schema it ran in", async () => {
    const applied = await db
      .withSchema(SCHEMA)
      .withTables<{ kysely_migration: { name: string } }>()
      .selectFrom("kysely_migration")
      .select("name")
      .orderBy("name")
      .execute();
    expect(applied.map((row) => row.name)).toEqual(Object.keys(migrations).sort());
  });

  it("creates the schema, and every table, view, index, and enum inside it", async () => {
    const relations = await relationsIn(db, SCHEMA);
    expect(relations).toContain("users");
    expect(relations).toContain("resource_directory");
    expect(relations).toContain("resource_analytics");
    expect(relations).toContain("resource_install_events_dedupe_idx");
    expect(await typesIn(db, SCHEMA)).toEqual(["identity_provider_kind", "skill_install_source", "user_role"]);
  });

  // The one thing that belongs in `public` is pg_trgm, which has to resolve
  // from any schema (ADR-0040). Anything else there was placed where the
  // application never looks.
  it("leaves nothing of its own in public", async () => {
    expect(await relationsIn(db, "public")).toEqual([]);
    expect(await typesIn(db, "public")).toEqual([]);
  });

  it("is idempotent, so every replica can run it at start-up", async () => {
    await runMigrations(db, SCHEMA);
    await runMigrations(db, SCHEMA);
    expect((await relationsIn(db, SCHEMA)).length).toBeGreaterThan(0);
  });
});
