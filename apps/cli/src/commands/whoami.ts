import { UserSchema } from "@skill-registry/shared";
import { NOT_LOGGED_IN_MESSAGE, readConfig, resolveCredentials } from "../config.js";
import { registryFetch, type RegistryClient } from "../http.js";

export interface WhoamiDeps {
  fetch: typeof fetch;
  configPath: string;
  env: NodeJS.ProcessEnv;
}

export interface WhoamiResult {
  registry: string;
  email: string;
  role: string;
}

/** Which Registry the CLI is talking to and who it's authenticated as (story 44). */
export async function runWhoami(deps: WhoamiDeps): Promise<WhoamiResult> {
  const fileConfig = await readConfig(deps.configPath);
  const credentials = resolveCredentials(deps.env, fileConfig);
  if (!credentials) throw new Error(NOT_LOGGED_IN_MESSAGE);

  const client: RegistryClient = { fetch: deps.fetch, registry: credentials.registry, token: credentials.token };
  const user = await registryFetch(client, "/users/me", UserSchema);

  return { registry: credentials.registry, email: user.email, role: user.role };
}
