import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Hono } from "hono";
import { createDatabase } from "../src/db/client.js";
import { runMigrations, waitForDatabase } from "../src/db/migrate.js";
import { createLogger } from "../src/logger.js";
import { FakeStorageAdapter } from "../src/storage/fake.js";
import { createApp } from "../src/app.js";

export const TEST_JWT_SECRET = "test-jwt-secret-do-not-use-in-production";

export interface TestContext {
  app: Hono;
  sql: ReturnType<typeof createDatabase>["sql"];
  db: ReturnType<typeof createDatabase>["db"];
  storage: FakeStorageAdapter;
}

/**
 * Seam 1 — the API request boundary: no server listens, `app.request(...)`
 * calls the Hono app directly against a real Postgres and a fake storage
 * adapter, per the spec's testing decisions.
 */
export async function startTestContext(): Promise<{
  context: TestContext;
  container: StartedPostgreSqlContainer;
}> {
  const container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const { sql, db } = createDatabase(container.getConnectionUri());

  await waitForDatabase(sql);
  await runMigrations(sql, db);
  // Migrations must be idempotent across restarts.
  await runMigrations(sql, db);

  const storage = new FakeStorageAdapter();
  const app = createApp({ sql, db, storage, jwtSecret: TEST_JWT_SECRET, logger: createLogger("silent") });

  return { context: { app, sql, db, storage }, container };
}

export async function stopTestContext(
  context: TestContext,
  container: StartedPostgreSqlContainer,
): Promise<void> {
  await context.sql.end();
  await container.stop();
}
