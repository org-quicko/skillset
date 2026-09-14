import { LOG_LEVELS, type LogLevel } from "./config.js";

/** Writes one diagnostic line, if `level` is at or above the logger's configured level. */
export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Builds a {@link Logger} that writes only to `process.stderr`.
 *
 * @param level - The minimum level to write; anything quieter is dropped.
 * @returns A logger with one method per {@link LogLevel}.
 *
 * @remarks
 * stdout carries the MCP JSON-RPC stream, so nothing here may touch it — hence
 * `console.error`/`process.stderr.write` rather than `console.log`, unconditionally.
 *
 * @example
 * ```ts
 * const logger = createLogger("info");
 * logger.warn("no results for query");
 * ```
 */
export function createLogger(level: LogLevel): Logger {
  const threshold = LOG_LEVELS.indexOf(level);

  const write = (messageLevel: LogLevel, message: string): void => {
    if (LOG_LEVELS.indexOf(messageLevel) < threshold) return;
    process.stderr.write(`[skillset-mcp] [${messageLevel}] ${message}\n`);
  };

  return {
    debug: (message) => write("debug", message),
    info: (message) => write("info", message),
    warn: (message) => write("warn", message),
    error: (message) => write("error", message),
  };
}
