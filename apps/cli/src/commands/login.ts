import { UserSchema, type Role } from "@skillset/shared";
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
  role: Role;
}

/**
 * Confirms a Token is accepted by a Registry, then stores both in the config file.
 *
 * @param deps - The fetch implementation and where the config file lives.
 * @param options - The Registry's URL and the Token minted from the web interface.
 * @returns The Registry, and the email and role of the User the Token belongs to.
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
