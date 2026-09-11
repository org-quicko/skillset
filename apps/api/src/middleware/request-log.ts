import { createMiddleware } from "hono/factory";
import type { RequestIdVariables } from "hono/request-id";
import type { Logger } from "../lib/logger.js";
import type { ClientIpEnv } from "./client-ip.js";

/** What `requestLog` puts on the context: a logger already carrying this request's id. */
export type RequestLogEnv = { Variables: { logger: Logger } };

/**
 * Logs one line per request, and puts a request-scoped logger on the context.
 *
 * @remarks
 * There was no access log and no request id at all, so an incident could not
 * be traced from a report to the requests that caused it (ISSUE-19). Every
 * line this emits carries `request_id`, which is also returned in the
 * `x-request-id` response header by `requestId()` upstream of this — so the
 * id in a bug report and the id in the logs are the same string.
 *
 * The path is logged, never the query string: `GET /resources?q=…` carries
 * whatever someone typed into a search box, and an access log is the wrong
 * place to keep it.
 *
 * `debug` for a success and `warn` for a 4xx/5xx, so the default `info` level
 * is quiet in normal operation and still records every refusal.
 *
 * @param logger - The process logger to derive the request-scoped child from.
 * @returns A middleware handler that sets `logger` on the context.
 * @example
 * ```ts
 * app.use("*", requestId(), requestLog(deps.logger));
 * ```
 */
export function requestLog(logger: Logger) {
  return createMiddleware<RequestLogEnv & ClientIpEnv & { Variables: RequestIdVariables }>(async (c, next) => {
    const child = logger.child({ request_id: c.get("requestId") });
    c.set("logger", child);

    const startedAt = performance.now();
    await next();

    const line = {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration_ms: Math.round(performance.now() - startedAt),
      client_ip: c.var.clientIp,
    };
    if (c.res.status >= 400) child.warn(line, "request refused");
    else child.debug(line, "request served");
  });
}
