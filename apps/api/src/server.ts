import { join } from "node:path";
import cron from "node-cron";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { runMigrations, waitForDatabase } from "./db/migrate.js";
import { createLogger } from "./lib/logger.js";
import { AnalyticsService } from "./features/analytics/analytics.service.js";
import { S3StorageAdapter } from "./storage/s3.js";
import { createApp } from "./app.js";

const logger = createLogger();

/**
 * The largest request body the runtime will accept, a little above the 2 MiB
 * `bodyLimit` the API enforces — so an oversized body is refused by this
 * app's own 413 rather than by the runtime dropping the connection.
 */
const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;

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

  // Where the browser is sent to upload: the public endpoint when the API and
  // the browser reach storage by different names, otherwise the one the API
  // uses. Undefined for AWS's own endpoint, whose hostname this app never
  // sees — `spaContentSecurityPolicy` says what that costs.
  const storageEndpoint = config.storage.publicEndpoint ?? config.storage.endpoint;
  const storageOrigin = storageEndpoint && URL.canParse(storageEndpoint) ? new URL(storageEndpoint).origin : undefined;

  const webDist = join(import.meta.dir, "../../web/dist");
  const webRoot = (await Bun.file(join(webDist, "index.html")).exists()) ? webDist : undefined;

  const app = createApp({
    sql,
    db,
    storage,
    webRoot,
    betterAuthSecret: config.betterAuthSecret,
    publicUrl: config.publicUrl,
    trustedProxies: config.trustedProxies,
    storageOrigin,
    logger,
  });

  // Only wired here, never inside createApp — a test app built via
  // startTestContext() must never start a real background timer (ADR-0012);
  // tests call refreshInstallCounts directly instead.
  const analytics = new AnalyticsService(db, logger);
  cron.schedule(config.analyticsRefreshCron, () => {
    analytics.refreshInstallCounts().catch((error) => {
      logger.error({ err: error }, "failed to refresh skill_analytics");
    });
  });

  // `maxRequestBodySize` bounds what the runtime will read before Hono sees
  // it at all; `bodyLimit` in app.ts is the per-route half of the same
  // ceiling (ISSUE-20). Bun's own default is 128 MB.
  Bun.serve({ fetch: app.fetch, port: config.port, maxRequestBodySize: MAX_REQUEST_BODY_BYTES });
  logger.info({ port: config.port, analytics_refresh_cron: config.analyticsRefreshCron }, "Sqillset listening");
}

main().catch((error) => {
  logger.fatal({ err: error }, "Sqillset failed to start");
  process.exit(1);
});
