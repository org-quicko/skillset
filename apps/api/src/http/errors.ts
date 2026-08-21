import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Shape from docs/openapi.json's Error schema. */
export function errorResponse(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  field?: string,
) {
  return c.json({ error: { code, message, ...(field ? { field } : {}) } }, status);
}

export function unauthenticated(c: Context) {
  return errorResponse(c, 401, "unauthenticated", "No valid session or Token.");
}

export function forbidden(c: Context, message: string) {
  return errorResponse(c, 403, "forbidden", message);
}
