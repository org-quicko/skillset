import { join } from "node:path";
import cron from "node-cron";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { runMigrations, waitForDatabase } from "./db/migrate.js";
import { createLogger } from "./logger.js";
import { refreshInstallCounts } from "./services/analytics.js";
import { S3StorageAdapter } from "./storage/s3.js";
import { createApp } from "./app.js";

const logger = createLogger();

async function main() {
  const config = loadConfig();
  const { sql, db } = createDatabase(config.databaseUrl);

  await waitForDatabase(sql);
  await runMigrations(sql, db);

  const storage = new S3StorageAdapter({
    bucket: config.storage.bucket,
    region: config.storage.region,
    accessKeyId: config.storage.accessKeyId,
    secretAccessKey: config.storage.secretAccessKey,
    endpoint: config.storage.endpoint,
    publicEndpoint: config.storage.publicEndpoint,
  });

  const webDist = join(import.meta.dir, "../../web/dist");
  const webRoot = (await Bun.file(join(webDist, "index.html")).exists()) ? webDist : undefined;

  const app = createApp({
    sql,
    db,
    storage,
    webRoot,
    jwtSecret: config.jwtSecret,
    publicUrl: config.publicUrl,
    logger,
  });

  // Only wired here, never inside createApp — a test app built via
  // startTestContext() must never start a real background timer (ADR-0012);
  // tests call refreshInstallCounts directly instead.
  cron.schedule(config.analyticsRefreshCron, () => {
    refreshInstallCounts({ db }).catch((error) => {
      logger.error({ err: error }, "failed to refresh skill_analytics");
    });
  });

  Bun.serve({ fetch: app.fetch, port: config.port });
  logger.info({ port: config.port, analytics_refresh_cron: config.analyticsRefreshCron }, "Skill Registry listening");
}

main().catch((error) => {
  logger.fatal({ err: error }, "Skill Registry failed to start");
  process.exit(1);
});
