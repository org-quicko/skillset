import { ApiError, apiErrorFrom, parseApiResponse } from "@skill-registry/shared";
import type { z } from "zod";

// Re-exported so the commands keep importing the error they catch from the
// module they call — the class itself is shared with the web interface
// (api-client.ts).
export { ApiError };

/** The registry couldn't be reached at all — a wrong URL or a dead network, not a rejected credential. */
export class RegistryUnreachableError extends Error {
  /**
   * @param registry - The URL that could not be reached, named in the message so a typo
   * is visible without re-running with a flag.
   * @param cause - Whatever `fetch` threw; its message is folded into this one.
   */
  constructor(registry: string, cause: unknown) {
    super(`Could not reach ${registry}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "RegistryUnreachableError";
  }
}

export interface RegistryClient {
  fetch: typeof fetch;
  registry: string;
  /** Absent for reads made without a Token (ADR-0013) and for the one call login makes before a Token is confirmed to work. */
  token?: string;
}

function authHeaders(client: RegistryClient): Record<string, string> {
  return client.token ? { authorization: `Bearer ${client.token}` } : {};
}

/** The one place a request actually leaves the CLI: URL building, transport failure, and the non-2xx decode, shared by both callers below. */
async function send(client: RegistryClient, path: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await client.fetch(new URL(`/api${path}`, client.registry), init);
  } catch (error) {
    throw new RegistryUnreachableError(client.registry, error);
  }

  if (!res.ok) throw await apiErrorFrom(res);
  return res;
}

/**
 * Sends one JSON request to the Registry — the single path every CLI call takes.
 *
 * @param client - Where to send the request and, when there is one, the Token to authenticate with.
 * @param path - Path under the API, e.g. `/users/me` — the `/api` mount prefix is added here.
 * @param schema - Parses the success response; pass `null` for a body-less response (e.g. 204).
 * @param init - Extra `fetch` options; its headers are merged over the defaults.
 * @returns The parsed response body, or `undefined` when `schema` is `null`.
 * @throws RegistryUnreachableError when the request never got an answer — a wrong URL or a
 * dead network.
 * @throws ApiError when the Registry answered with a non-2xx status, carrying that status
 * and the API's own error code so callers can tell a rejected credential from a refusal.
 * @throws ZodError when a 2xx body does not match `schema`.
 *
 * @remarks
 * Mirrors apps/web's `apiFetch`: a schema shapes the success response, and every failure
 * comes back as one of two typed errors (story 44). Decoding a refusal and parsing a
 * success body are both `shared`'s, so the two clients cannot make different sense of the
 * same response — what is left here is the Bearer Token and the transport failure, which
 * is all a CLI does differently.
 *
 * @example
 * ```ts
 * const user = await registryFetch(client, "/users/me", UserSchema);
 * ```
 */
export async function registryFetch<T>(
  client: RegistryClient,
  path: string,
  schema: z.ZodType<T> | null,
  init: RequestInit = {},
): Promise<T> {
  const res = await send(client, path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...authHeaders(client),
      ...init.headers,
    },
  });

  return parseApiResponse(res, schema);
}

/**
 * Downloads a binary response — in practice, a Skill's Artifact.
 *
 * @param client - Where to send the request and, when there is one, the Token to authenticate with.
 * @param path - Path under the API, e.g. `/resources/{id}/artifact`.
 * @returns The response body as bytes.
 * @throws RegistryUnreachableError when the request never got an answer.
 * @throws ApiError when the Registry answered with a non-2xx status.
 *
 * @remarks
 * The Registry serves the bytes itself — for an Artifact, a zip it assembles from the
 * files it stores (ADR-0032) — so this is one request to one origin, authenticated with
 * our own Bearer Token.
 *
 * @example
 * ```ts
 * const bytes = await downloadBinary(client, `/resources/${skill.id}/artifact`);
 * ```
 */
export async function downloadBinary(client: RegistryClient, path: string): Promise<Uint8Array> {
  const res = await send(client, path, { headers: authHeaders(client) });
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Uploads one file of an Artifact straight to storage, bypassing the API entirely
 * (ADR-0001) — hence no `/api` prefix and no auth header, since the URL is already
 * presigned.
 *
 * @param fetchImpl - The fetch implementation to use.
 * @param target - The presigned destination for this file, as the publish response
 * returned it.
 * @param bytes - The file's bytes.
 * @throws RegistryUnreachableError when storage never got an answer.
 * @throws Error naming the file when storage answered with a non-2xx status.
 *
 * @example
 * ```ts
 * await uploadArtifactFile(fetch, published.upload.files[0], bundle.files[0].bytes);
 * ```
 */
export async function uploadArtifactFile(
  fetchImpl: typeof fetch,
  target: { path: string; url: string; method: "PUT"; headers: Record<string, string> },
  bytes: Uint8Array,
): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(target.url, { method: target.method, headers: target.headers, body: bytes });
  } catch (error) {
    throw new RegistryUnreachableError(target.url, error);
  }
  if (!res.ok) {
    throw new Error(`Uploading "${target.path}" failed with status ${res.status}.`);
  }
}
