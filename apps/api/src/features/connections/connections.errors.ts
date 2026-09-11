import { AppError } from "../../lib/errors.js";

/**
 * More than one Integration is configured for a Git Provider, and the caller
 * did not say which to use (ADR-0025).
 *
 * @remarks
 * Only reached on a connect attempt with no `integration_id`: a caller with
 * exactly one Integration to choose from never sees this, because there is
 * nothing to choose. The interface avoids it entirely by always sending the
 * id of whichever app the writer picked from the list.
 */
export class IntegrationChoiceRequiredError extends AppError {
  constructor(provider: string) {
    super(
      400,
      "integration_choice_required",
      `More than one integration is configured for ${provider} — specify which one to connect through.`,
      { field: "integration_id" },
    );
  }
}

/**
 * The Git Provider named has no credentialed import flow at all, so it cannot
 * be connected.
 *
 * @remarks
 * Distinct from an unconfigured Integration, because no Admin can fix it: a
 * GitHub App has no GitLab equivalent, so GitLab is public-read only by design
 * (ADR-0024). Telling a writer to go and ask an Admin would send them on an
 * errand that cannot succeed.
 */
export class ProviderNotConnectableError extends AppError {
  constructor(provider: string) {
    super(
      400,
      "provider_not_connectable",
      `${provider} cannot be connected — this Registry reads only its public projects.`,
      { field: "provider" },
    );
  }
}

/**
 * The `state` on a connect callback was missing, tampered with, expired,
 * already used, or minted for somebody else.
 *
 * @remarks
 * One code for all five, deliberately. This is the CSRF surface of the connect
 * flow, and telling a caller *which* check failed tells an attacker which part
 * of their forgery to fix. The log line records the specific cause.
 */
export class ConnectionStateInvalidError extends AppError {
  constructor() {
    super(400, "invalid_state", "That connection attempt could not be verified. Start again from settings.");
  }
}

/**
 * The writer declined the authorization at the provider.
 *
 * @remarks
 * Told apart from `ConnectionStateInvalidError` because it is not a failure at
 * all — it is the writer's own decision, arriving as the provider's
 * `error=access_denied`. Reporting it as an attempt that "could not be
 * verified" reads as a security problem and invites them to retry the very
 * thing they just refused.
 */
export class ConnectionDeclinedError extends AppError {
  constructor(provider: string) {
    super(400, "authorization_declined", `You did not authorize ${provider}, so nothing was connected.`);
  }
}

/** The Git Provider refused to exchange the authorization code for a token. */
export class ConnectionExchangeFailedError extends AppError {
  constructor(provider: string) {
    super(502, "exchange_failed", `${provider} would not complete that connection. Try again from settings.`);
  }
}

/**
 * The caller holds no Connection, so there is no grant to Import through.
 *
 * @remarks
 * Distinct from `ConnectionNotFoundError`, which answers "disconnect what?".
 * This one answers "import as whom?", and the remedy is a connect action the
 * writer takes themselves — so it is a precondition failure rather than a
 * missing resource.
 *
 * It also covers a writer who linked GitHub under the old design: they hold no
 * `connections` row, so they correctly read as not connected without anyone
 * inspecting scopes (ADR-0024).
 */
export class NotConnectedError extends AppError {
  constructor(provider: string) {
    super(409, "not_connected", `Connect your ${provider} account in settings to import from a private project.`);
  }
}

/** The caller holds no Connection for the Git Provider named. */
export class ConnectionNotFoundError extends AppError {
  constructor() {
    super(404, "not_found", "You have no connection to that Git Provider.");
  }
}

/**
 * The Connection's grant is no longer usable and the writer must reconnect.
 *
 * @remarks
 * The wording is load-bearing and was wrong before ADR-0024: it must say
 * *reconnect*, never "sign in again". The import token stopped coming from the
 * login, so signing in refreshes nothing and sending someone to do it wastes
 * their time on a remedy that cannot work.
 *
 * It also names a second cause, because the provider's 403 does not tell the
 * two apart: the app may lack a permission, which no amount of reconnecting
 * fixes. Without that clause a writer whose Admin misconfigured the app
 * reconnects indefinitely and nobody learns why.
 */
export class ConnectionExpiredError extends AppError {
  constructor(provider: string) {
    super(
      409,
      "connection_expired",
      `${provider} would not accept your connection. Reconnect it from settings — and if that does not help, ` +
        `ask an administrator to check the app's permissions.`,
    );
  }
}
