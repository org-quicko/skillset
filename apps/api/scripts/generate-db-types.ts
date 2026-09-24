import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";

// Generated from a throwaway database migrated from scratch, not from whatever
// DATABASE_URL points at, so the types describe exactly what the migrations
// build. Migrated into `public` so every generated table name is unqualified —
// the client's `withSchema` supplies the real schema at runtime.
const container = await new PostgreSqlContainer("postgres:18-alpine").start();
try {
  const { db, close } = createDatabase(container.getConnectionUri(), "public");
  await runMigrations(db, "public");
  await close();

  const codegen = Bun.spawn(["bunx", "kysely-codegen", "--url", container.getConnectionUri(), ...Bun.argv.slice(2)], {
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exitCode = await codegen.exited;
} finally {
  await container.stop();
}
