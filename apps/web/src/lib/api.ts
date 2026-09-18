import { ApiError, apiErrorFrom, parseApiResponse } from "@in-org-quicko/skillset-shared";
import type { z } from "zod";
import { queryClient } from "./query-client";
import { discardSessionState } from "./query-keys";

// Re-exported so components keep importing the error they catch from the
// module they call — the class itself is shared with the CLI (api-client.ts).
export { ApiError };

/** What every "did this mutation fail" message shows: the server's own reason, or a generic fallback. */
export function apiErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Something went wrong.";
  return error.field ? `${error.message} (${error.field})` : error.message;
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
 * The one place every request goes through. `schema` shapes the success
 * response — there is no hand-written mapping step. Pass `null` when the
 * response has no body (a 204, e.g. logout).
 *
 * @remarks
 * Decoding a refusal and parsing a success body are both `shared`'s
 * (`apiErrorFrom`, `parseApiResponse`), so this and the CLI's `registryFetch`
 * cannot drift in what they make of the same response. What is left here is
 * what only a browser does: same-origin `/api`, cookie credentials, and the
 * session reset on a 401.
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

  if (!res.ok) throw await apiErrorFrom(res);
  return parseApiResponse(res, schema);
}

/** The browser-facing URL of an API path — for an `<img src>`, an `<iframe>`, or a top-level navigation. */
export function apiUrl(path: string): string {
  return `/api${path}`;
}

/**
 * Fetches a response the API serves as text rather than JSON — a file out of
 * a Resource's Artifact.
 *
 * @remarks
 * Deliberately not `apiFetch`: that one sends `content-type: application/json`
 * and hands the body to a Zod schema, neither of which fits bytes. What it
 * shares is the parts that must not drift — same-origin `/api`, cookie
 * credentials, the session reset on a 401, and `apiErrorFrom` for a refusal.
 *
 * @param path - The path under the API, e.g. `/resources/{id}/files/SKILL.md`.
 * @returns The response body, decoded as UTF-8.
 * @throws ApiError when the API answered with a non-2xx status.
 * @example
 * ```ts
 * const source = await apiFetchText(`/resources/${id}/files/SKILL.md`);
 * ```
 */
export async function apiFetchText(path: string): Promise<string> {
  const res = await fetch(apiUrl(path), { credentials: "include" });

  if (res.status === 401) discardSessionState(queryClient);
  if (!res.ok) throw await apiErrorFrom(res);

  return res.text();
}
