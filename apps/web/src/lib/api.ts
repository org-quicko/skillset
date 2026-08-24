import { ErrorResponseSchema } from "@skill-registry/shared";
import type { z } from "zod";
import { queryClient } from "./query-client";
import { discardSessionState } from "./query-keys";

export class ApiError extends Error {
  code: string;
  field?: string;

  constructor(code: string, message: string, field?: string) {
    super(message);
    this.code = code;
    this.field = field;
  }
}

/** What every "did this mutation fail" message shows: the server's own reason, or a generic fallback. */
export function apiErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong.";
}

export interface ApiFetchOptions extends RequestInit {
  /**
   * Set by callers for whom a 401 is an expected, meaningful result rather
   * than an expired session — right now just "who am I", which is how the
   * app finds out nobody is logged in. Clearing the cache in reaction to
   * that probe's own request would wipe the query it's part of while it is
   * still resolving.
   */
  suppressAuthReset?: boolean;
}

/**
 * The one place every request goes through, and the only place a response
 * body is parsed. `schema` shapes the success response — there is no
 * hand-written mapping step. Pass `null` when the response has no body
 * (a 204, e.g. logout).
 */
export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T> | null,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { suppressAuthReset, ...init } = options;
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init.headers },
  });

  if (res.status === 401 && !suppressAuthReset) {
    discardSessionState(queryClient);
  }

  if (!res.ok) {
    const parsed = ErrorResponseSchema.safeParse(await res.json().catch(() => null));
    const error = parsed.success
      ? parsed.data.error
      : { code: "unknown_error", message: "Something went wrong." };
    throw new ApiError(error.code, error.message, error.field);
  }

  if (schema === null) return undefined as T;
  return schema.parse(await res.json());
}
