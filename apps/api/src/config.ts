import cron from "node-cron";

export interface Config {
  port: number;
  databaseUrl: string;
  betterAuthSecret: string;
  /**
   * Absolute base URL this Registry is reached at. Required: Better Auth
   * builds every callback and cookie boundary from it (ADR-0016), so unlike
   * the optional `PUBLIC_URL` this replaces, an instance cannot start without
   * one even with no Identity Provider configured.
   */
  publicUrl: string;
  /** Cron expression governing how often `skill_analytics` is refreshed (ADR-0012). */
  analyticsRefreshCron: string;
  storage: {
    bucket: string;
    region: string | undefined;
    accessKeyId: string | undefined;
    secretAccessKey: string | undefined;
    endpoint: string | undefined;
    publicEndpoint: string | undefined;
  };
}

/**
 * Reads and validates the environment into a typed Config.
 *
 * @remarks
 * Required variables are checked up front so a misconfiguration fails at
 * startup rather than surfacing later as a runtime error on the first
 * request that needs them.
 *
 * @param env - The environment to read from. Defaults to `process.env`;
 * overridable for tests.
 * @returns `Config`
 * @throws Error if `BETTER_AUTH_SECRET`, `DATABASE_URL`, `PUBLIC_URL`, or `STORAGE_BUCKET` is
 * missing, if `PORT` is set to something other than a valid port number, if
 * `PUBLIC_URL` is set to something that is not an absolute http(s) URL, or if
 * `ANALYTICS_REFRESH_CRON` is set to something `node-cron` cannot parse as a
 * cron expression (ADR-0012).
 * @example
 * ```ts
 * const config = loadConfig();
 * ```
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const analyticsRefreshCron = env.ANALYTICS_REFRESH_CRON ?? "*/30 * * * * *";
  if (!cron.validate(analyticsRefreshCron)) {
    throw new Error(
      `Invalid environment variable ANALYTICS_REFRESH_CRON: "${analyticsRefreshCron}" is not a valid cron expression.`,
    );
  }

  const betterAuthSecret = env.BETTER_AUTH_SECRET;
  if (!betterAuthSecret) {
    throw new Error(
      "Missing required environment variable BETTER_AUTH_SECRET: refusing to start without a signing secret.",
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

  // Validated at startup rather than where a login uses it, so a typo
  // surfaces on boot instead of halfway through someone's first sign-in.
  const publicUrl = env.PUBLIC_URL?.replace(/\/+$/, "");
  if (!publicUrl) {
    throw new Error("Missing required environment variable PUBLIC_URL.");
  }
  if (!URL.canParse(publicUrl) || !/^https?:$/.test(new URL(publicUrl).protocol)) {
    throw new Error(`Invalid environment variable PUBLIC_URL: "${publicUrl}" is not an absolute http(s) URL.`);
  }

  const rawPort = env.PORT ?? "3000";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid environment variable PORT: "${rawPort}" is not a valid port number.`);
  }

  return {
    port,
    databaseUrl,
    betterAuthSecret,
    publicUrl,
    analyticsRefreshCron,
    storage: {
      bucket,
      region: env.STORAGE_REGION,
      accessKeyId: env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
      endpoint: env.STORAGE_ENDPOINT,
      publicEndpoint: env.STORAGE_PUBLIC_ENDPOINT,
    },
  };
}
