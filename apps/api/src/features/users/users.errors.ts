import { AppError } from "../../lib/errors.js";

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
