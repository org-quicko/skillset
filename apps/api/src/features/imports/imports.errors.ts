import { AppError } from "../../lib/errors.js";

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
