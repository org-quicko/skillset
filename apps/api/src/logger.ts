import pino, { type Logger as PinoLogger } from "pino";

export type Logger = PinoLogger;

// Defensive: nothing in this API deliberately logs a password, token secret,
// or session credential — this only guards against a future log call that
// accidentally passes a whole row or header through.
const REDACT_PATHS = [
  "password",
  "*.password",
  "password_hash",
  "*.password_hash",
  "token",
  "*.token",
  "token_hash",
  "*.token_hash",
  "secret",
  "*.secret",
  "authorization",
  "*.authorization",
  "jwt",
  "*.jwt",
];

/**
 * Builds the process-wide Pino logger, pretty-printed in development and
 * structured JSON elsewhere, with credential-shaped fields always redacted.
 *
 * @param level - The minimum level to log at. Defaults to `LOG_LEVEL` from
 * the environment, or `"info"` if that's unset.
 * @returns `Logger`
 */
export function createLogger(level: string = process.env.LOG_LEVEL ?? "info"): Logger {
  // Pretty-printing is a dev convenience; skip the transport (and its worker
  // thread) entirely in production or when logging is off, e.g. in tests.
  const usePrettyTransport = level !== "silent" && process.env.NODE_ENV !== "production";

  return pino({
    level,
    // Pino's default `level` is its numeric severity (30, 50, ...); this
    // reports the label ("info", "error", ...) instead, in both JSON and
    // pretty-printed output.
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    serializers: { err: pino.stdSerializers.err },
    ...(usePrettyTransport ? { transport: { target: "pino-pretty" } } : {}),
  });
}
