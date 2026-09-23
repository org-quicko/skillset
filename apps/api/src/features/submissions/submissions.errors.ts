import { AppError } from "../../lib/errors.js";

/** No Submission exists by the requested id. */
export class SubmissionNotFoundError extends AppError {
  constructor() {
    super(404, "not_found", "No Submission by that id.");
  }
}

/**
 * The Resource being submitted, or approved, is already in the Registry under
 * the same `(kind, namespace, name)`.
 *
 * @remarks
 * 409 rather than a silent replace: approving would otherwise overwrite a
 * Resource someone already published, on the say-so of whoever submitted a
 * copy of it.
 */
export class ResourceAlreadyPublishedError extends AppError {
  constructor(namespace: string, name: string) {
    super(409, "already_published", `${namespace}/${name} is already in the Registry.`);
  }
}

/** A Submission must say which repository its files came from (ADR-0044). */
export class SubmissionSourceRequiredError extends AppError {
  constructor() {
    super(400, "source_required", "A Submission must name the repository it came from.", { field: "source" });
  }
}

/** Approval found no uploaded files — the submitter's upload never finished. */
export class SubmissionIncompleteError extends AppError {
  constructor() {
    super(409, "submission_incomplete", "This Submission's files were never uploaded.");
  }
}
