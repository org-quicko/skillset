import { UserSchema } from "@skill-registry/shared";
import { writeConfig, type Config } from "../config.js";
import { ApiError, registryFetch, type RegistryClient } from "../http.js";

export interface LoginDeps {
  fetch: typeof fetch;
  configPath: string;
}

export interface LoginOptions {
  registry: string;
  token: string;
}

export interface LoginResult {
  registry: string;
  email: string;
  role: string;
}

/**
 * Confirms `options.token` is accepted by `options.registry`, then stores
 * both in the config file. A rejected credential (401) leaves the config
 * file untouched; an unreachable registry surfaces as a distinct error
 * (`RegistryUnreachableError`, thrown by `registryFetch`) so a wrong URL is
 * never mistaken for a revoked Token (story 44).
 */
export async function runLogin(deps: LoginDeps, options: LoginOptions): Promise<LoginResult> {
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
