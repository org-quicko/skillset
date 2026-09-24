import { AppError } from "../../lib/errors.js";

/** No Resource exists by the requested id (or, for a name-keyed lookup, `(kind, name)`). */
export class ResourceNotFoundError extends AppError {
  constructor() {
    super(404, "not_found", "No Resource by that id.");
  }
}

/**
 * A bare name matched Resources in more than one Namespace, and none of them
 * is this Registry's own (ADR-0042).
 *
 * @remarks
 * 409 rather than 404: every candidate exists, and the request is answerable
 * the moment the caller says which one they mean. The message names the
 * Namespaces so that is one step, not a search — it is what the CLI reprints
 * when it refuses to guess which Skill to install.
 *
 * Never raised when one candidate was published here: a bare name means "the
 * team's own" wherever there is one, which is what keeps unqualified names
 * working exactly as they did before Namespaces existed.
 */
export class AmbiguousResourceNameError extends AppError {
  constructor(name: string, namespaces: readonly string[]) {
    super(
      409,
      "ambiguous_name",
      `More than one Resource is called "${name}". Name which one: ${namespaces.join(", ")}.`,
      { field: "namespace" },
    );
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
 * The stored Artifact is larger than one may be, so the API refuses to read
 * it into memory.
 *
 * @remarks
 * Only reachable through the drift ADR-0001 accepts: nothing verifies that
 * the bytes a publisher uploads match the sizes they declared, and a
 * presigned PUT cannot be signed for a maximum length. Refusing on the way
 * out is what keeps an oversized upload from being turned into unbounded
 * memory use on an unauthenticated read (ISSUE-5).
 */
export class ArtifactTooLargeError extends AppError {
  constructor(bytes: number) {
    super(
      413,
      "artifact_too_large",
      `This Resource's stored Artifact is ${bytes} bytes, more than an Artifact may hold, and cannot be served.`,
    );
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
