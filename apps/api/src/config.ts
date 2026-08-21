export interface Config {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  storage: {
    bucket: string;
    region: string | undefined;
    accessKeyId: string | undefined;
    secretAccessKey: string | undefined;
    endpoint: string | undefined;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error(
      "Missing required environment variable JWT_SECRET: refusing to start without a signing secret.",
    );
  }

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Missing required environment variable DATABASE_URL.");
  }

  // Required from ticket 03 on: publishing presigns an upload against a
  // bucket, so an unset one is a startup failure rather than a runtime one on
  // the first publish.
  const bucket = env.STORAGE_BUCKET;
  if (!bucket) {
    throw new Error("Missing required environment variable STORAGE_BUCKET.");
  }

  const rawPort = env.PORT ?? "3000";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid environment variable PORT: "${rawPort}" is not a valid port number.`);
  }

  return {
    port,
    databaseUrl,
    jwtSecret,
    storage: {
      bucket,
      region: env.STORAGE_REGION,
      accessKeyId: env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
      endpoint: env.STORAGE_ENDPOINT,
    },
  };
}
