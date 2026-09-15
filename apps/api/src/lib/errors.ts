import { SkillValidationError, TagValidationError } from "@in-org-quicko/sqillset-shared";
import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Logger } from "./logger.js";

/** Every error body is `{ error: { code, message, field? } }` — docs/openapi.json's Error schema. */
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
 * Builds the API's error handler: the one place a thrown error becomes a response.
 *
 * @remarks
 * Routes and services throw an `AppError` subclass for an expected failure, the
 * shared `SkillValidationError`/`TagValidationError` for a broken Skill or Tag
 * rule, or Hono's `HTTPException` (a malformed JSON body, say). Anything else is
 * a bug: it is logged with its stack and answered with a generic 500.
 *
 * @param logger - Where caught errors are logged.
 * @returns An `ErrorHandler` for `app.onError`.
 * @example
 * ```ts
 * api.onError(onError(logger));
 * ```
 */
export function onError(logger: Logger): ErrorHandler {
  return (err, c) => {
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

    // Raised by Hono itself — a body `zValidator` could not parse is the case
    // that reaches here — and a 4xx from it is the caller's request, not a bug.
    if (err instanceof HTTPException && err.status < 500) {
      logger.debug({ status: err.status }, err.message);
      return errorResponse(c, err.status, err.status === 400 ? "validation_failed" : "request_rejected", err.message);
    }

    logger.error({ err }, "Unhandled error");
    return errorResponse(c, 500, "internal_error", "Something went wrong.");
  };
}

/** An unmatched `/api` path answers in the API's own error shape rather than Hono's plain-text 404. */
export const notFound: NotFoundHandler = (c) => errorResponse(c, 404, "not_found", "No such route.");
