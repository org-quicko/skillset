import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Hono } from "hono";
import { createDatabase } from "../src/db/client.js";
import { runMigrations, waitForDatabase } from "../src/db/migrate.js";
import { FakeStorageAdapter } from "../src/storage/fake.js";
import { createApp } from "../src/app.js";

/**
 * Seam 1 — the API request boundary: no server listens, `app.request(...)`
 * calls the Hono app directly against a real Postgres and a fake storage
 * adapter, per the spec's testing decisions.
 */
describe("API request boundary", () => {
  let container: StartedPostgreSqlContainer;
  let sql: ReturnType<typeof createDatabase>["sql"];
  let app: Hono;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:18-alpine").start();
    const database = createDatabase(container.getConnectionUri());
    sql = database.sql;

    await waitForDatabase(sql);
    await runMigrations(sql, database.db);
    // Migrations must be idempotent across restarts.
    await runMigrations(sql, database.db);

    app = createApp({ sql, storage: new FakeStorageAdapter() });
  }, 60_000);

  afterAll(async () => {
    await sql.end();
    await container.stop();
  });

  it("answers a health check via a real database round trip", async () => {
    const res = await app.request("/api/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
