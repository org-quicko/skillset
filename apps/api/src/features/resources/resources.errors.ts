import { AppError } from "../../lib/errors.js";

/** No Resource exists by the requested id (or, for a name-keyed lookup, `(kind, name)`). */
export class ResourceNotFoundError extends AppError {
  constructor() {
    super(404, "not_found", "No Resource by that id.");
  }
}

/**
 * The row exists but nothing was ever written to its Artifact's key — an
 * abandoned publish (spec, "Further Notes"), not a missing Resource.
 */
export class ArtifactMissingError extends AppError {
  constructor() {
    super(404, "artifact_missing", "This Resource's Artifact was never uploaded.");
  }
}

/** The Resource's Artifact exists but holds no file at the requested path. */
export class ArtifactFileNotFoundError extends AppError {
  constructor(path: string) {
    super(404, "not_found", `This Resource's Artifact holds no file at "${path}".`);
  }
}

/**
 * A Resource's delete failed for a reason other than a missing key. Reported
 * generically rather than distinguished, since the caller cannot act
 * differently either way — the real cause still reaches the logs via `cause`.
 */
export class ResourceDeleteFailedError extends AppError {
  constructor(cause: unknown) {
    super(500, "delete_failed", "Something went wrong.", { cause });
  }
}
