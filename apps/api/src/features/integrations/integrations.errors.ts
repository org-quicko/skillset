import { AppError } from "../../lib/errors.js";

/** No Integration exists by the requested id. */
export class IntegrationNotFoundError extends AppError {
  constructor() {
    super(404, "not_found", "No such Integration.");
  }
}

/**
 * An Integration could not be deleted because a Connection still references
 * it.
 *
 * @remarks
 * `connections.integration_id` references this table `ON DELETE RESTRICT`
 * (ADR-0024): removing an Integration writers still hold Connections against
 * must fail loudly, not silently drop their credentials. `update` can clear
 * Connections deliberately, with a reason writers are told about — a plain
 * delete does not get to do that silently, so it refuses instead.
 */
export class IntegrationInUseError extends AppError {
  constructor() {
    super(
      409,
      "integration_in_use",
      "One or more writers still hold a Connection through this Integration. Disconnect them first, or edit the " +
        "Integration to repoint it at a different app instead of deleting it.",
    );
  }
}

/**
 * No Integration is configured for the Git Provider a request names, so there
 * is no credential to connect with or import through.
 *
 * @remarks
 * An Admin's problem, not the caller's, and the message says so. This is the
 * refusal that stands in for ADR-0023's `import_enabled`: an Integration row's
 * existence is the only switch Importing has (ADR-0024), so its absence is the
 * "switched off" state.
 */
export class IntegrationNotConfiguredError extends AppError {
  constructor(provider: string) {
    super(
      409,
      "integration_not_configured",
      `Importing from ${provider} is not configured on this Registry. Ask an administrator to set it up.`,
    );
  }
}
