import { ErrorResponseSchema } from "@skill-registry/shared";
import type { z } from "zod";

/** Mirrors apps/web/src/lib/api.ts's ApiError — same shape, same source (the API's error body). */
export class ApiError extends Error {
  status: number;
  code: string;
  field?: string;

  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

/** The registry couldn't be reached at all — a wrong URL or a dead network, not a rejected credential. */
export class RegistryUnreachableError extends Error {
  constructor(registry: string, cause: unknown) {
    super(`Could not reach ${registry}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "RegistryUnreachableError";
  }
}

export interface RegistryClient {
  fetch: typeof fetch;
  registry: string;
  /** Absent for the one call login makes before a Token is confirmed to work. */
  token?: string;
}

/**
 * The one place every CLI request goes through, mirroring apps/web's
 * `apiFetch`: a schema shapes the success response, and every failure comes
 * back as one of two typed errors so callers can tell "wrong URL" from
 * "rejected credential" from "server said no" (story 44).
 *
 * @param client - Where to send the request and, once known, the Token to authenticate with.
 * @param path - Path under the API, e.g. `/users/me` — the `/api` mount prefix is added here.
 * @param schema - Parses the success response; pass `null` for a body-less response (e.g. 204).
 */
export async function registryFetch<T>(
  client: RegistryClient,
  path: string,
  schema: z.ZodType<T> | null,
  init: RequestInit = {},
): Promise<T> {
  let res: Response;
  try {
    res = await client.fetch(new URL(`/api${path}`, client.registry), {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(client.token ? { authorization: `Bearer ${client.token}` } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    throw new RegistryUnreachableError(client.registry, error);
  }

  if (!res.ok) {
    const parsed = ErrorResponseSchema.safeParse(await res.json().catch(() => null));
    const error = parsed.success
      ? parsed.data.error
      : { code: "unknown_error", message: `Request failed with status ${res.status}.` };
    throw new ApiError(res.status, error.code, error.message, error.field);
  }

  if (schema === null) return undefined as T;
  return schema.parse(await res.json());
}

/** Uploads Artifact bytes straight to storage (ADR-0001) — never through the API, so no `/api` prefix and no auth header. */
export async function uploadArtifact(
  fetchImpl: typeof fetch,
  target: { url: string; method: "PUT"; headers: Record<string, string> },
  bytes: Uint8Array,
): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(target.url, { method: target.method, headers: target.headers, body: bytes });
  } catch (error) {
    throw new RegistryUnreachableError(target.url, error);
  }
  if (!res.ok) {
    throw new Error(`Uploading the Artifact failed with status ${res.status}.`);
  }
}
