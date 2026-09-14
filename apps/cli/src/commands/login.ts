import { UserSchema, type Role } from "@in-org-quicko/skillset-shared";
import { writeConfig, type Config } from "../config.js";
import { ApiError, registryFetch, type RegistryClient } from "../http.js";

export interface LoginDeps {
  fetch: typeof fetch;
  configPath: string;
}

export interface LoginOptions {
  registry: string;
  token: string;
  /** Permits a plain-`http` Registry that is not on this machine — see `assertTransportIsSafe`. */
  insecure?: boolean;
}

/** Hosts where plain `http` is a loopback connection that never leaves the machine. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Refuses to store a Token for a Registry it would be sent to in the clear.
 *
 * @remarks
 * `skillset login --registry http://...` stored the Token and then sent it in
 * an `authorization` header on every call afterwards, readable by anything on
 * the path (ISSUE-22). The Token carries its owner's full role, so that is a
 * writer's publish rights on an open network.
 *
 * Loopback is exempt because the bytes never reach a network — that is the
 * quick start's own `http://localhost:3000`. Anything else needs `--insecure`
 * said out loud, which keeps a deliberate plain-http deployment working while
 * making the accidental one a refusal rather than a silent handover.
 *
 * @param registry - The Registry's URL, as given.
 * @param insecure - Whether the caller passed `--insecure`.
 * @throws Error if `registry` is not a valid absolute URL.
 * @throws Error if `registry` is plain `http` on a non-loopback host and
 * `insecure` was not passed.
 * @example
 * ```ts
 * assertTransportIsSafe("http://registry.example", false); // throws
 * assertTransportIsSafe("http://localhost:3000", false); // fine
 * ```
 */
export function assertTransportIsSafe(registry: string, insecure: boolean | undefined): void {
  let url: URL;
  try {
    url = new URL(registry);
  } catch {
    throw new Error(`"${registry}" is not a valid Registry URL.`);
  }

  if (url.protocol === "https:" || insecure) return;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return;

  throw new Error(
    `Refusing to send a Token to ${url.origin} over ${url.protocol.replace(":", "")}: it would travel in ` +
      "the clear on every call. Use an https URL, or pass --insecure if this Registry really is plain http.",
  );
}

export interface LoginResult {
  registry: string;
  email: string;
  role: Role;
}

/**
 * Confirms a Token is accepted by a Registry, then stores both in the config file.
 *
 * @param deps - The fetch implementation and where the config file lives.
 * @param options - The Registry's URL, the Token minted from the web interface, and whether
 * a plain-http Registry was explicitly permitted.
 * @returns The Registry, and the email and role of the User the Token belongs to.
 * @throws Error before contacting anything if the Registry is plain `http` and not on this
 * machine (ISSUE-22) — see `assertTransportIsSafe`.
 * @throws Error saying the Token was rejected when the Registry answers 401 — the config
 * file is left untouched, so a bad Token never displaces a working one.
 * @throws RegistryUnreachableError when the Registry cannot be reached at all, so a wrong
 * URL is never mistaken for a revoked Token (story 44).
 * @throws ApiError for any other refusal from the Registry.
 *
 * @example
 * ```ts
 * const { email, role } = await runLogin(deps, { registry: "https://registry.example", token });
 * ```
 */
export async function runLogin(deps: LoginDeps, options: LoginOptions): Promise<LoginResult> {
  // Before the request, not after: the point is that the Token is never sent
  // over that transport at all, not that it is not stored afterwards.
  assertTransportIsSafe(options.registry, options.insecure);

  const client: RegistryClient = { fetch: deps.fetch, registry: options.registry, token: options.token };

  let user;
  try {
    user = await registryFetch(client, "/users/me", UserSchema);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw new Error("Token rejected — mint a new one from the web interface.");
    }
    throw error;
  }

  const config: Config = { registry: options.registry, token: options.token };
  await writeConfig(deps.configPath, config);

  return { registry: options.registry, email: user.email, role: user.role };
}
