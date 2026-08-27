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
 * Base of every error the API deliberately raises for an expected failure —
 * self-describing (status + code baked in at construction) so `onError`
 * below never needs a lookup table mapping error types to responses; adding
 * a new domain error never requires touching it.
 */
export class AppError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly field?: string;

  /**
   * @param status - The HTTP status code the error should respond with.
   * @param code - The machine-readable error code returned in the response body.
   * @param message - The human-readable error message.
   * @param options - Optional extras: `field` names the request field the error
   * relates to, and `cause` is attached to the Error's native `cause`.
   */
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
  /** Builds the 401 `unauthenticated` error. */
  constructor() {
    super(401, "unauthenticated", "No valid session or Token.");
  }
}

/** The caller is authenticated but not allowed to perform this action. */
export class ForbiddenError extends AppError {
  /** @param message - Explains why the action is forbidden. */
  constructor(message: string) {
    super(403, "forbidden", message);
  }
}

/** A request failed validation before reaching the domain logic. */
export class ValidationError extends AppError {
  /**
   * @param message - The human-readable validation failure.
   * @param field - The request field that failed validation, if any.
   */
  constructor(message: string, field?: string) {
    super(400, "validation_failed", message, { field });
  }
}

/** A login attempt's email or password didn't match. */
export class InvalidCredentialsError extends AppError {
  /** Builds the 401 `invalid_credentials` error. */
  constructor() {
    super(401, "invalid_credentials", "Unknown email or wrong password.");
  }
}

/** Setup was attempted after the instance already has a first superadmin. */
export class AlreadyInitializedError extends AppError {
  /** Builds the 409 `already_initialized` error. */
  constructor() {
    super(409, "already_initialized", "A User already exists.");
  }
}

/** No Skill exists by the requested id. */
export class SkillNotFoundError extends AppError {
  /** Builds the 404 `not_found` error. */
  constructor() {
    super(404, "not_found", "No Skill by that id.");
  }
}

/**
 * The row exists but nothing was ever written to its Artifact's key — an
 * abandoned publish (spec, "Further Notes"), not a missing Skill.
 */
export class ArtifactMissingError extends AppError {
  /** Builds the 404 `artifact_missing` error. */
  constructor() {
    super(404, "artifact_missing", "This Skill's Artifact was never uploaded.");
  }
}

/** No Token by that id exists that belongs to the caller. */
export class TokenNotFoundError extends AppError {
  /** Builds the 404 `not_found` error. */
  constructor() {
    super(404, "not_found", "No such Token belonging to you.");
  }
}

/** No User exists by the requested id. */
export class UserNotFoundError extends AppError {
  /** Builds the 404 `not_found` error. */
  constructor() {
    super(404, "not_found", "No such User.");
  }
}

/** A User was created, or renamed via email, to an email another User already holds. */
export class EmailTakenError extends AppError {
  /** Builds the 409 `email_taken` error. */
  constructor() {
    super(409, "email_taken", "A User with that email already exists.", { field: "email" });
  }
}

/**
 * A role change or removal targeted the Superadmin — set once at `/setup`
 * and never reassigned, changed, or removed afterwards (docs/data-model.md).
 */
export class SuperadminProtectedError extends AppError {
  /** Builds the 409 `superadmin_protected` error. */
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
  /** Builds the 403 `password_change_required` error. */
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
  /** @param cause - The underlying error the delete failed with. */
  constructor(cause: unknown) {
    super(500, "delete_failed", "Something went wrong.", { cause });
  }
}

/** No Tag exists by the requested id. */
export class TagNotFoundError extends AppError {
  /** Builds the 404 `not_found` error. */
  constructor() {
    super(404, "not_found", "No Tag by that id.");
  }
}

/** A rename targeted a name a different Tag already holds (ADR-0011). */
export class TagNameConflictError extends AppError {
  /** Builds the 409 `tag_name_conflict` error. */
  constructor() {
    super(409, "tag_name_conflict", "A Tag by that name already exists.", { field: "name" });
  }
}

/** No Identity Provider exists by the requested id or slug. */
export class IdentityProviderNotFoundError extends AppError {
  /** Builds the 404 `not_found` error. */
  constructor() {
    super(404, "not_found", "No such Identity Provider.");
  }
}

/** A Provider was created with a slug another Provider already holds. */
export class IdentityProviderSlugTakenError extends AppError {
  /** Builds the 409 `slug_taken` error. */
  constructor() {
    super(409, "slug_taken", "An Identity Provider with that slug already exists.", { field: "slug" });
  }
}

/**
 * Enabling a Provider was refused because it has no permitted domain or
 * tenant. With just-in-time provisioning it is the only control on who gets
 * an account (ADR-0015), so an ungated Provider is not enablable at all —
 * the database carries the same rule as a check constraint.
 */
export class IdentityProviderUngatedError extends AppError {
  /** Builds the 400 `provider_ungated` error. */
  constructor() {
    super(
      400,
      "provider_ungated",
      "Set a permitted domain or tenant before enabling this Identity Provider: it is what decides who may sign in.",
      { field: "permitted_domain" },
    );
  }
}

/**
 * A login through an Identity Provider failed. Deliberately one error for
 * every cause — a bad nonce, an unverified email, the wrong hosted domain —
 * because the person at the other end can act no differently either way, and
 * distinguishing them would tell an attacker which check they tripped. The
 * real reason reaches the logs.
 */
export class ExternalLoginFailedError extends AppError {
  /** @param reason - Logged, never returned; what actually failed. */
  constructor(readonly reason: string) {
    super(401, "external_login_failed", "That sign-in could not be completed.");
  }
}

/**
 * A login was started against a Provider, but the Registry does not know the
 * URL it is reached at, so it cannot build the `redirect_uri` to come back to.
 */
export class PublicUrlNotConfiguredError extends AppError {
  /** Builds the 500 `public_url_not_configured` error. */
  constructor() {
    super(500, "public_url_not_configured", "This Registry has no PUBLIC_URL configured, so it cannot complete a sign-in.");
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
