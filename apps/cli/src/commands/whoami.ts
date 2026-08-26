import { UserSchema, type Role } from "@skill-registry/shared";
import { registryFetch } from "../http.js";
import { openAuthenticatedClient, type SessionDeps } from "../session.js";

export type WhoamiDeps = SessionDeps;

export interface WhoamiResult {
  registry: string;
  email: string;
  role: Role;
}

/**
 * Reports which Registry the CLI is talking to and who it is authenticated as.
 *
 * @param deps - The fetch implementation, config-file path, and environment to resolve
 * the Registry and Token from.
 * @returns The Registry's URL, and the email and role of the authenticated User.
 * @throws Error explaining how to authenticate when neither the config file nor the
 * environment supplies a Registry and a Token.
 * @throws ApiError when the Registry rejects the Token, and
 * `RegistryUnreachableError` when it cannot be reached — reported separately so a wrong
 * location is distinguishable from a rejected Token (story 44).
 *
 * @example
 * ```ts
 * const { registry, email, role } = await runWhoami({ fetch, configPath, env: process.env });
 * ```
 */
export async function runWhoami(deps: WhoamiDeps): Promise<WhoamiResult> {
  const client = await openAuthenticatedClient(deps);
  const user = await registryFetch(client, "/users/me", UserSchema);

  return { registry: client.registry, email: user.email, role: user.role };
}
