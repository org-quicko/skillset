import type { GitProviderOAuth } from "./git-provider-oauth.js";

/**
 * What one Git Provider looks like, as data.
 *
 * @remarks
 * A table rather than an interface with an implementation per provider
 * (ADR-0024). Adding a provider is a key in `GIT_PROVIDERS` plus a branch in
 * the walk; there is no registry, no plugin, and nothing to register at
 * startup.
 *
 * `api_base` and `raw_host` are constants and must stay constants. They are
 * the reason a caller-supplied value cannot move a request to another host,
 * which is the whole of ADR-0020's request-forgery defence — self-hosted
 * instances are out of scope precisely because they would make these
 * configuration.
 */
export interface GitProviderConfig {
  /** For messages a writer reads. */
  display_name: string;
  /** The host a browse URL is pasted from. */
  host: string;
  /** Pinned API origin and prefix. Never operator-supplied. */
  api_base: string;
  /**
   * The host file bytes come from, when it is not `api_base`'s. `null` means
   * bytes are served by the API itself, so there is no second host to
   * allowlist.
   */
  raw_host: string | null;
  /** Segments a project path must have, at least. */
  min_project_segments: number;
  /** Segments a project path may have at most; `null` for unbounded. */
  max_project_segments: number | null;
  /**
   * Browse-URL shapes, tried in order. Each captures the same three things in
   * the same positions — project path, ref, folder path — so the parser does
   * not care which provider matched.
   *
   * A shape naming no ref leaves group 2 undefined, which resolves the default
   * branch.
   */
  url_patterns: readonly RegExp[];
  /**
   * The credentialed import flow's endpoints, or `null` for a provider that
   * has none and is therefore public-read only.
   *
   * Null is the whole of what "the credential layer is per-provider" means in
   * code: GitLab has no GitHub App equivalent, so it cannot be connected, and
   * `/connections/:provider/start` refuses it rather than inventing a flow
   * (ADR-0024).
   */
  oauth: GitProviderOAuth | null;
}
