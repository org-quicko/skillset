import { AppError } from "../../lib/errors.js";

/** Setup was attempted after the instance already has a first superadmin. */
export class AlreadyInitializedError extends AppError {
  constructor() {
    super(409, "already_initialized", "A User already exists.");
  }
}
