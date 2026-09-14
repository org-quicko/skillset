/**
 * Where a Git Provider's credentialed import flow sends a writer, and where
 * its tokens are exchanged.
 *
 * @remarks
 * Separate from the rest of `GitProviderConfig` and **nullable there**,
 * because the credential layer is deliberately *not* generic: a GitHub App has
 * no GitLab equivalent, so GitLab carries `oauth: null` and is public-read
 * only (ADR-0024). A null here is the honest statement "this provider has no
 * credentialed import", not a gap waiting to be filled.
 *
 * All three URLs are pinned constants for the same reason `api_base` is: they
 * are what stops a caller-supplied value moving a request to another host
 * (ADR-0020).
 */
export interface GitProviderOAuth {
  /**
   * Where a writer goes to authorize the Registry, producing the code that is
   * exchanged for their token.
   *
   * @remarks
   * Deliberately the plain authorize endpoint rather than the installation
   * page, which the connect flow used until it was found to be unable to
   * re-authorize. GitHub mints a code from the installation page **only on a
   * first install**; every later visit lands on its update-permissions screen
   * and returns no code, so a writer who had already installed the app could
   * never reconnect. This endpoint issues a code whether the app is installed
   * or not.
   *
   * The cost is that choosing repositories is now a separate trip, to
   * `install_url_template`.
   */
  authorize_url: string;
  /**
   * Where a writer goes to choose which repositories the Registry may read,
   * with `{app_slug}` substituted from the Integration.
   *
   * @remarks
   * Repository access only — this grants no credential and mints no code, so
   * it is **not** part of the connect flow and nothing waits on its return.
   * A provider whose Setup URL points at our callback will bounce back there
   * carrying `setup_action` and no code, which the callback route treats as
   * "nothing was authorized" rather than as a failed attempt.
   */
  install_url_template: string;
  /** Where an authorization code is exchanged for tokens. */
  token_url: string;
}
