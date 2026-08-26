import { NO_REGISTRY_MESSAGE, NOT_LOGGED_IN_MESSAGE, readConfig, resolveCredentials, resolveRegistryAccess } from "./config.js";
import type { RegistryClient } from "./http.js";

/** What every command past `login` needs to work out where it is talking and as whom. */
export interface SessionDeps {
  fetch: typeof fetch;
  configPath: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Builds the client a write needs, refusing to go any further without a Token.
 *
 * @param deps - The fetch implementation, config-file path, and environment to resolve from.
 * @returns A client carrying the resolved Registry location and Token.
 * @throws Error explaining how to authenticate when neither the config file nor the
 * environment supplies both halves; or whatever {@link readConfig} throws for a malformed
 * config file.
 *
 * @example
 * ```ts
 * const client = await openAuthenticatedClient({ fetch, configPath, env: process.env });
 * ```
 */
export async function openAuthenticatedClient(deps: SessionDeps): Promise<RegistryClient> {
  const credentials = resolveCredentials(deps.env, await readConfig(deps.configPath));
  if (!credentials) throw new Error(NOT_LOGGED_IN_MESSAGE);
  return { fetch: deps.fetch, registry: credentials.registry, token: credentials.token };
}

/**
 * Builds the client a read needs, which is the Registry's location and nothing more.
 *
 * @param deps - The fetch implementation, config-file path, and environment to resolve from.
 * @returns A client for the resolved Registry, carrying a Token only if one happens to be
 * configured — reads do not require authentication (ADR-0013).
 * @throws Error naming the Registry as the missing piece when no location is configured;
 * or whatever {@link readConfig} throws for a malformed config file.
 *
 * @example
 * ```ts
 * const client = await openReadClient({ fetch, configPath, env: process.env });
 * ```
 */
export async function openReadClient(deps: SessionDeps): Promise<RegistryClient> {
  const access = resolveRegistryAccess(deps.env, await readConfig(deps.configPath));
  if (!access) throw new Error(NO_REGISTRY_MESSAGE);
  return { fetch: deps.fetch, registry: access.registry, token: access.token };
}
