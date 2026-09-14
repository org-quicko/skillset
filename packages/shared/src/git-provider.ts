import type { GitProviderConfig } from "./git-provider-config.js";

/**
 * The Git Providers this Registry can read a Skill folder from.
 *
 * @remarks
 * Cloud only. GitLab is here for the anonymous public path; the credentialed
 * path is GitHub alone, because a GitHub App has no GitLab equivalent and
 * pretending the credential layer generalises would be the one wrong
 * abstraction here (ADR-0024).
 *
 * Order matters within `url_patterns`: the shape naming a ref is tried first,
 * because a bare-root pattern is permissive enough to swallow one.
 */
export const GIT_PROVIDERS: Record<string, GitProviderConfig> = {
  github: {
    display_name: "GitHub",
    host: "github.com",
    api_base: "https://api.github.com",
    raw_host: "https://raw.githubusercontent.com",
    min_project_segments: 2,
    // GitHub has no nested groups: a project is exactly `owner/repo`.
    max_project_segments: 2,
    url_patterns: [
      /^\/([^/]+\/[^/]+?)(?:\.git)?\/tree\/([^/]+)(?:\/(.*))?$/,
      /^\/([^/]+\/[^/]+?)(?:\.git)?\/?$/,
    ],
    oauth: {
      // Authorization and repository selection are two trips, not one. The
      // installation page below looked like it could do both, but it mints a
      // code only on a *first* install — so it could never reconnect a writer
      // who had already installed the app (ADR-0024).
      authorize_url: "https://github.com/login/oauth/authorize",
      install_url_template: "https://github.com/apps/{app_slug}/installations/new",
      token_url: "https://github.com/login/oauth/access_token",
    },
  },
  gitlab: {
    display_name: "GitLab",
    host: "gitlab.com",
    api_base: "https://gitlab.com/api/v4",
    // Blobs come from the same API host, so there is no second host to trust.
    raw_host: null,
    min_project_segments: 2,
    // Nested groups: `group/subgroup/.../project` is one project, any depth.
    max_project_segments: null,
    url_patterns: [
      /^\/(.+?)(?:\.git)?\/-\/tree\/([^/]+)(?:\/(.*))?$/,
      /^\/(.+?)(?:\.git)?\/?$/,
    ],
    // No credentialed import: there is no GitLab equivalent of a GitHub App,
    // and pretending the credential layer generalises would be the one wrong
    // abstraction here (ADR-0024). Public projects only.
    oauth: null,
  },
};

/** The provider keys, for a picker or an error message. */
export const GIT_PROVIDER_KEYS = Object.keys(GIT_PROVIDERS);

/**
 * Whether a string names a Git Provider this Registry knows.
 *
 * @remarks
 * The only list of valid provider names in the codebase is `GIT_PROVIDERS`
 * itself. `provider` is a plain string in the database and in every request
 * shape — no enum, no union type — constrained in Postgres by a foreign key
 * to `integrations.provider` and in code by this predicate (ADR-0024). Nothing
 * else may hardcode a provider list.
 *
 * @param provider - The candidate name.
 * @returns Whether a config exists for it.
 * @example
 * ```ts
 * if (!isGitProvider(input.provider)) throw new ValidationError("Unknown Git Provider.");
 * ```
 */
export function isGitProvider(provider: string): boolean {
  return Object.hasOwn(GIT_PROVIDERS, provider);
}

/**
 * The config for a Git Provider.
 *
 * @param provider - The provider name.
 * @returns Its config.
 * @throws Error if no such provider is known. Callers reaching this have
 * skipped `isGitProvider` on a value from outside, which is a bug rather than
 * a refusal to render.
 * @example
 * ```ts
 * const { api_base } = gitProviderConfig("github");
 * ```
 */
export function gitProviderConfig(provider: string): GitProviderConfig {
  const config = GIT_PROVIDERS[provider];
  if (!config) {
    throw new Error(`Unknown Git Provider "${provider}". Known: ${GIT_PROVIDER_KEYS.join(", ")}.`);
  }
  return config;
}

/**
 * The Git Provider a host belongs to, if any.
 *
 * @param hostname - A URL's hostname, as `URL` reports it.
 * @returns The provider name, or `null` when the host is not one we read from.
 * @example
 * ```ts
 * providerForHost("gitlab.com"); // "gitlab"
 * ```
 */
export function providerForHost(hostname: string): string | null {
  const host = hostname.toLowerCase();
  return GIT_PROVIDER_KEYS.find((provider) => GIT_PROVIDERS[provider]?.host === host) ?? null;
}
