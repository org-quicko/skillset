import type { z } from "zod";
import { ErrorResponseSchema } from "./error.js";

/**
 * A refusal the Registry answered with, decoded from its error body.
 *
 * @remarks
 * One class for both clients. The web interface and the CLI each used to
 * declare their own — identical in shape, since both are built from the same
 * `ErrorResponseSchema`, and each carrying its own copy of the decode — so a
 * field added to the API's error body had to be added twice, and a divergence
 * between them was invisible until something branched on `code` in one place
 * and not the other.
 *
 * `code` is the API's own machine-readable code and the thing to branch on;
 * `status` and `field` are carried for the callers that want them. Never
 * thrown by the API itself — it raises `AppError` subclasses, which become the
 * body this decodes.
 */
export class ApiError extends Error {
  // Declared and assigned rather than written as parameter properties: the web
  // interface compiles shared code with erasableSyntaxOnly.
  readonly status: number;
  readonly code: string;
  readonly field: string | undefined;

  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

/**
 * Decodes a non-2xx response into an `ApiError`.
 *
 * @remarks
 * A response whose body is not the API's error shape — a proxy's HTML error
 * page, an empty 502, a truncated body — still has to produce an `ApiError`,
 * because every caller's failure path is written against that one type. Such a
 * response falls back to `unknown_error` and the status.
 *
 * Consumes the body, so a caller must not read it again.
 *
 * @param res - The refused response.
 * @returns The error to throw.
 * @example
 * ```ts
 * if (!res.ok) throw await apiErrorFrom(res);
 * ```
 */
export async function apiErrorFrom(res: Response): Promise<ApiError> {
  const parsed = ErrorResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    return new ApiError(res.status, "unknown_error", `Request failed with status ${res.status}.`);
  }

  const { code, message, field } = parsed.data.error;
  return new ApiError(res.status, code, message, field);
}

/**
 * Parses a 2xx response's body against the schema the caller expects.
 *
 * @remarks
 * The one place a success body is turned into a value, and the one place the
 * body-less case is handled: a 204 has nothing to parse, and both clients
 * express that by passing `null` rather than inventing an empty schema per
 * route.
 *
 * @param res - The successful response.
 * @param schema - The shape the body must satisfy, or `null` for a response
 * with no body.
 * @returns The parsed body, or `undefined` when `schema` is `null`.
 * @throws ZodError if the body does not satisfy `schema` — a server that
 * answered 2xx with the wrong shape is a fault worth surfacing, not one to
 * paper over.
 * @example
 * ```ts
 * return parseApiResponse(res, UserSchema);
 * ```
 */
export async function parseApiResponse<T>(res: Response, schema: z.ZodType<T> | null): Promise<T> {
  // The cast is the price of one signature serving both cases. Confined here
  // so no caller has to write it: `T` is `undefined` by the caller's own
  // choice of a `null` schema.
  if (schema === null) return undefined as T;
  return schema.parse(await res.json());
}
