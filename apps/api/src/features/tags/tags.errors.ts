import { AppError } from "../../lib/errors.js";

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
