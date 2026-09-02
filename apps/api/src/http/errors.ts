import { SkillValidationError, TagValidationError } from "@skill-registry/shared";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AuthVariables } from "../auth/middleware.js";
import type { Logger } from "../logger.js";

/** Shape from docs/openapi.json's Error schema. */
function errorResponse(c: Context, status: ContentfulStatusCode, code: string, message: string, field?: string) {
  return c.json({ error: { code, message, ...(field ? { field } : {}) } }, status);
}

/**
 * Base of every error the API raises for an expected failure. Status and code
 * are baked in at construction, so `onError` below needs no error-to-response
 * lookup table and a new domain error never touches it.
 */
export class AppError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly field?: string;

  /** `options.cause` is attached to the Error's native `cause`, not stored separately. */
  constructor(
    status: ContentfulStatusCode,
    code: string,
    message: string,
    options?: { field?: string; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.field = options?.field;
  }
}

/** No valid session or Token was presented on a request that requires one. */
export class UnauthenticatedError extends AppError {
  constructor() {
    super(401, "unauthenticated", "No valid session or Token.");
  }
}

/** The caller is authenticated but not allowed to perform this action. */
export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(403, "forbidden", message);
  }
}

/** A request failed validation before reaching the domain logic. */
export class ValidationError extends AppError {
  constructor(message: string, field?: string) {
    super(400, "validation_failed", message, { field });
  }
}

/** Setup was attempted after the instance already has a first superadmin. */
export class AlreadyInitializedError extends AppError {
  constructor() {
    super(409, "already_initialized", "A User already exists.");
  }
}

/** No Skill exists by the requested id. */
export class SkillNotFoundError extends AppError {
  constructor() {
    super(404, "not_found", "No Skill by that id.");
  }
}

/**
 * The row exists but nothing was ever written to its Artifact's key — an
 * abandoned publish (spec, "Further Notes"), not a missing Skill.
 */
export class ArtifactMissingError extends AppError {
  constructor() {
    super(404, "artifact_missing", "This Skill's Artifact was never uploaded.");
  }
}

/** No Token by that id exists that belongs to the caller. */
export class TokenNotFoundError extends AppError {
  constructor() {
    super(404, "not_found", "No such Token belonging to you.");
  }
}

/** No User exists by the requested id. */
export class UserNotFoundError extends AppError {
  constructor() {
    super(404, "not_found", "No such User.");
  }
}

/** A User was created, or renamed via email, to an email another User already holds. */
export class EmailTakenError extends AppError {
  constructor() {
    super(409, "email_taken", "A User with that email already exists.", { field: "email" });
  }
}

/**
 * A role change or removal targeted the Superadmin — set once at `/setup`
 * and never reassigned, changed, or removed afterwards (docs/data-model.md).
 */
export class SuperadminProtectedError extends AppError {
  constructor() {
    super(
      409,
      "superadmin_protected",
      "Refused: this is the Superadmin. Their role is permanent and their account can never be changed or removed.",
    );
  }
}

/**
 * A generated password was never replaced (docs/data-model.md's
 * `must_change_password`), and the request was for anything other than
 * reading the caller's own record or replacing their own password.
 */
export class PasswordChangeRequiredError extends AppError {
  constructor() {
    super(403, "password_change_required", "You must replace your generated password before doing anything else.");
  }
}

/**
 * A Skill's delete failed for a reason other than a missing key. Reported
 * generically rather than distinguished, since the caller cannot act
 * differently either way — the real cause still reaches the logs via `cause`.
 */
export class SkillDeleteFailedError extends AppError {
  constructor(cause: unknown) {
    super(500, "delete_failed", "Something went wrong.", { cause });
  }
}

/** No Tag exists by the requested id. */
export class TagNotFoundError extends AppError {
  constructor() {
    super(404, "not_found", "No Tag by that id.");
  }
}

/** A rename targeted a name a different Tag already holds (ADR-0011). */
export class TagNameConflictError extends AppError {
  constructor() {
    super(409, "tag_name_conflict", "A Tag by that name already exists.", { field: "name" });
  }
}

/** No Identity Provider exists by the requested id or kind. */
export class IdentityProviderNotFoundError extends AppError {
  constructor() {
    super(404, "not_found", "No such Identity Provider.");
  }
}

/**
 * A Provider was created for a kind that already has one. There is at most one
 * Provider per kind (ADR-0017), so the second is a conflict rather than an
 * addition — an Admin who meant to change the first should edit it.
 */
export class IdentityProviderKindTakenError extends AppError {
  constructor() {
    super(409, "kind_taken", "An Identity Provider of that kind is already configured.", { field: "kind" });
  }
}

/** No Integration is configured for the requested Git Provider. */
export class IntegrationNotFoundError extends AppError {
  constructor() {
    super(404, "not_found", "No such Integration.");
  }
}

/**
 * An Integration was created for a Git Provider that already has one. There is
 * at most one Integration per provider (ADR-0024) — it is the row's identity —
 * so the second is a conflict rather than an addition, and an Admin who meant
 * to change the first should edit it.
 */
export class IntegrationProviderTakenError extends AppError {
  constructor() {
    super(409, "provider_taken", "An Integration for that Git Provider is already configured.", {
      field: "provider",
    });
  }
}

/**
 * No Integration is configured for the Git Provider a request names, so there
 * is no credential to connect with or import through.
 *
 * @remarks
 * An Admin's problem, not the caller's, and the message says so. This is the
 * refusal that stands in for ADR-0023's `import_enabled`: an Integration row's
 * existence is the only switch Importing has (ADR-0024), so its absence is the
 * "switched off" state.
 */
export class IntegrationNotConfiguredError extends AppError {
  constructor(provider: string) {
    super(
      409,
      "integration_not_configured",
      `Importing from ${provider} is not configured on this Registry. Ask an administrator to set it up.`,
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

/**
 * Every error response in the API is produced here, and only here: routes
 * and services throw — an `AppError` subclass, the shared
 * `SkillValidationError`, or, for a genuine bug, anything else — and this is
 * the single place that turns it into both a log line and a response.
 * Known 4xx/5xx `AppError`s are logged for visibility; anything not
 * recognized is treated as an unexpected failure and logged at `error` with
 * its stack trace.
 *
 * @param app - The Hono app to register the handler on.
 * @param logger - Where caught errors are logged.
 */
export function registerErrorHandler(app: Hono<{ Variables: AuthVariables }>, logger: Logger): void {
  app.onError((err, c) => {
    if (err instanceof AppError) {
      if (err.status >= 500) {
        logger.error({ err, code: err.code }, err.message);
      } else {
        logger.debug({ status: err.status, code: err.code }, err.message);
      }
      return errorResponse(c, err.status, err.code, err.message, err.field);
    }

    if (err instanceof SkillValidationError || err instanceof TagValidationError) {
      logger.debug({ code: err.rule, field: err.field }, err.message);
      return errorResponse(c, 400, err.rule, err.message, err.field);
    }

    logger.error({ err }, "Unhandled error");
    return errorResponse(c, 500, "internal_error", "Something went wrong.");
  });
}

/**
 * An Import failed upstream: the provider refused, was unreachable, or
 * answered with something untrustworthy.
 *
 * @remarks
 * A 502 because the fault genuinely is at the gateway — this is not the error
 * for a folder the caller chose badly, which is `ImportRejectedError`. Keeping
 * the two apart is what lets a client tell "try again later" from "fix the
 * folder", and keeps a writer pointing at an oversized directory out of the
 * 5xx rate an operator alerts on.
 *
 * Unlike an external login's refusal, the reason is safe to pass on and
 * useful: the caller is an authenticated writer acting on their own
 * Connection, so naming the cause is what lets them act and reveals nothing
 * they did not already know.
 */
export class ImportFailedError extends AppError {
  /** Builds the 502 `import_failed` error, carrying the walk's own sentence. */
  constructor(message: string) {
    super(502, "import_failed", message);
  }
}

/**
 * The folder the caller named cannot be published as a Skill: it is empty, or
 * larger than an Artifact may be.
 *
 * @remarks
 * A 4xx, deliberately, and the distinction from `ImportFailedError` is not
 * cosmetic. Nothing failed upstream — the request was answered perfectly well
 * and the answer is that this folder is not a Skill. Reporting it as 502 would
 * tell a client to retry something that will never succeed, and would page an
 * operator every time someone pasted a URL to a large directory.
 *
 * The ceilings are the ones `buildArtifact` enforces, so a folder refused here
 * would have been refused after upload anyway; catching it during the walk
 * just saves the bytes.
 */
export class ImportRejectedError extends AppError {
  /** Builds the 422 `import_rejected` error, carrying the walk's own sentence. */
  constructor(message: string) {
    super(422, "import_rejected", message);
  }
}

/**
 * The Registry's app is not installed on the account that owns the project, so
 * the writer's Connection cannot see it however good their own access is.
 *
 * @remarks
 * The most important refusal in the Import path, and the least obvious. A
 * writer who is **not** an organisation owner cannot complete an installation:
 * GitHub records a request for an owner to approve, and surfaces that state to
 * us only as a 404. Without naming it, "an owner has not approved your
 * installation request" is indistinguishable from a typo in the URL — so the
 * message names the owner and carries the install link, which is the whole
 * point of spending a request on `GET /user/installations` to diagnose it
 * (ADR-0024).
 */
export class AppNotInstalledError extends AppError {
  /**
   * Builds the 409 `app_not_installed` error.
   *
   * @param owner - The account that owns the project, named so the writer
   * knows who to ask.
   * @param installUrl - Where to install it, or `null` when the Integration
   * carries no app slug to build one from.
   */
  constructor(owner: string, installUrl: string | null) {
    super(
      409,
      "app_not_installed",
      `This Registry's app is not installed on "${owner}", so your connection cannot see that project. ` +
        (installUrl
          ? `Install it at ${installUrl} — if you are not an owner of "${owner}", one of them has to approve the request.`
          : `Ask an owner of "${owner}" to install it.`),
    );
  }
}
