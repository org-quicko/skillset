import { join } from "node:path";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { runMigrations, waitForDatabase } from "./db/migrate.js";
import { S3StorageAdapter } from "./storage/s3.js";
import { createApp } from "./app.js";

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

  const app = createApp({ sql, db, storage, webRoot, jwtSecret: config.jwtSecret });

  Bun.serve({ fetch: app.fetch, port: config.port });
  console.log(`Skill Registry listening on port ${config.port}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
