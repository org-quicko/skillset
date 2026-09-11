import { AppError } from "../../lib/errors.js";

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
