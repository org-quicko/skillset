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
 * A User tried to import from GitHub without a linked GitHub account. Not a
 * failure of the request so much as a missing prerequisite: importing runs as
 * the caller's own GitHub identity (ADR-0020), so there is nobody to run as.
 */
export class GitHubNotConnectedError extends AppError {
  /** Builds the 409 `github_not_connected` error. */
  constructor() {
    super(
      409,
      "github_not_connected",
      "Sign in with GitHub once to let the Registry read repositories you have access to.",
    );
  }
}

/**
 * An import from GitHub could not be completed. Unlike an external login's
 * refusal, the reason is safe to pass on and useful: the caller is an
 * authenticated writer acting on their own access, so telling them the folder
 * was missing or the token stale is what lets them fix it.
 */
export class GitHubImportFailedError extends AppError {
  /** Builds the 502 `github_import_failed` error. */
  constructor(message: string) {
    super(502, "github_import_failed", message);
  }
}
