import pino, { type Logger as PinoLogger } from "pino";

export type Logger = PinoLogger;

// Defensive: nothing in this API deliberately logs a password, token secret,
// or session credential — this only guards against a future log call that
// accidentally passes a whole row or header through.
//
// Every entry appears twice over, as `x` and `*.x`, because pino's wildcard
// matches exactly one level. That is also why the request-header paths below
// are spelled out: `*.authorization` does not reach
// `req.headers.authorization`, so a single `logger.info({ req })` would have
// printed a Bearer Token in full (ISSUE-19).
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
  // A Provider row is now read whole to configure Better Auth (ADR-0019), so
  // this is the field most likely to reach a log by accident — and unlike a
  // password hash it is a live third-party credential (ADR-0015).
  "client_secret",
  "*.client_secret",
  "*.*.client_secret",
  "authorization",
  "*.authorization",
  "*.*.authorization",
  "req.headers.authorization",
  "cookie",
  "*.cookie",
  "*.*.cookie",
  "req.headers.cookie",
  "set-cookie",
  "*.set-cookie",
  "res.headers['set-cookie']",
  "jwt",
  "*.jwt",
];

/**
 * `Failed query: … params: …` — how a wrapped query error opens both its
 * message and its stack.
 *
 * Unanchored on purpose: the message begins with it, the stack begins
 * `Error: Failed query: …`, and a caused-by chain can carry it more than once.
 */
const QUERY_PARAMS = /(Failed query:[\s\S]*?\nparams:)[^\n]*/g;

/**
 * Serializes a caught error for logging, with any bound query parameters
 * taken out.
 *
 * @remarks
 * A query error of that shape carries, in its *message*, the SQL and the
 * parameters it was run with. Those parameters are rows: a
 * password hash on a failed `accounts` insert, a client secret on a failed
 * `identity_providers` update. Pino's redaction works on fields, so it cannot
 * reach inside a message string — the only place to take them out is here,
 * before the error becomes a log line (ISSUE-19).
 *
 * The SQL itself is kept. It is what makes the line diagnosable, and it is
 * this repo's own code rather than anybody's data.
 */
function serializeError(error: unknown): ReturnType<typeof pino.stdSerializers.err> {
  // Pino copies an error's own enumerable properties onto the line, and
  // such an error keeps `params` as one of them — so the values have to
  // be dropped as a field as well as scrubbed out of the text.
  const { params: _params, ...serialized } = pino.stdSerializers.err(error as Error) as ReturnType<
    typeof pino.stdSerializers.err
  > & { params?: unknown };

  return {
    ...serialized,
    message: serialized.message?.replace(QUERY_PARAMS, "$1 [REDACTED]"),
    stack: serialized.stack?.replace(QUERY_PARAMS, "$1 [REDACTED]"),
  };
}

/**
 * Builds the process-wide Pino logger, pretty-printed in development and
 * structured JSON elsewhere, with credential-shaped fields always redacted.
 *
 * @param level - The minimum level to log at. Defaults to `LOG_LEVEL` from
 * the environment, or `"info"` if that's unset.
 * @param destination - Where lines are written. Defaults to stdout; a test
 * passes a stream so it can assert on what a line actually contains, which is
 * the only way to check redaction rather than assume it.
 * @returns `Logger`
 * @example
 * ```ts
 * const logger = createLogger("info");
 * ```
 */
export function createLogger(
  level: string = process.env.LOG_LEVEL ?? "info",
  destination?: pino.DestinationStream,
): Logger {
  // Pretty-printing is a dev convenience; skip the transport (and its worker
  // thread) entirely in production, when logging is off, or when a caller
  // supplied its own destination — a transport would send lines to a worker
  // instead of to it.
  const usePrettyTransport = level !== "silent" && !destination && process.env.NODE_ENV !== "production";

  const options: pino.LoggerOptions = {
    level,
    // Pino's default `level` is its numeric severity (30, 50, ...); this
    // reports the label ("info", "error", ...) instead, in both JSON and
    // pretty-printed output.
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    serializers: { err: serializeError },
    ...(usePrettyTransport ? { transport: { target: "pino-pretty" } } : {}),
  };

  return destination ? pino(options, destination) : pino(options);
}
