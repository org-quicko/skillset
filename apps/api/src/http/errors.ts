import { SkillValidationError } from "@skill-registry/shared";
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

export class UnauthenticatedError extends AppError {
  constructor() {
    super(401, "unauthenticated", "No valid session or Token.");
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(403, "forbidden", message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, field?: string) {
    super(400, "validation_failed", message, { field });
  }
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    super(401, "invalid_credentials", "Unknown email or wrong password.");
  }
}

export class AlreadyInitializedError extends AppError {
  constructor() {
    super(409, "already_initialized", "A User already exists.");
  }
}

export class SkillNotFoundError extends AppError {
  constructor() {
    super(404, "not_found", "No Skill by that name.");
  }
}

// The row exists but nothing was ever written to its Artifact's key — an
// abandoned publish (spec, "Further Notes"), not a missing Skill.
export class ArtifactMissingError extends AppError {
  constructor() {
    super(404, "artifact_missing", "This Skill's Artifact was never uploaded.");
  }
}

export class TokenNotFoundError extends AppError {
  constructor() {
    super(404, "not_found", "No such Token belonging to you.");
  }
}

// Either delete failing for a reason other than a missing key is reported
// generically rather than distinguished, since the caller cannot act
// differently either way — the real cause still reaches the logs via `cause`.
export class SkillDeleteFailedError extends AppError {
  constructor(cause: unknown) {
    super(500, "delete_failed", "Something went wrong.", { cause });
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

    if (err instanceof SkillValidationError) {
      logger.debug({ code: err.rule, field: err.field }, err.message);
      return errorResponse(c, 400, err.rule, err.message, err.field);
    }

    logger.error({ err }, "Unhandled error");
    return errorResponse(c, 500, "internal_error", "Something went wrong.");
  });
}
