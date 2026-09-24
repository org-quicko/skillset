import { ApiError } from "./http.js";
import { describeError } from "./ui.js";

/**
 * Whether `--json` was passed. Module state rather than threaded through every
 * command, because it is set once from the root option before any action runs
 * and is read by all of them — the same shape commander's own global options
 * have.
 */
let enabled = false;

/** Records whether `--json` was passed, for {@link jsonMode} to answer. */
export function setJsonMode(on: boolean): void {
  enabled = on;
}

/** Whether output should be machine-readable rather than the clack rendering. */
export function jsonMode(): boolean {
  return enabled;
}

/** The error shape `--json` prints, matching the API's own `{ error: { code, message, field? } }`. */
export interface JsonError {
  error: {
    code: string;
    message: string;
    /** The Registry's HTTP status, absent for a failure that never reached it. */
    status?: number;
    /** Which field the Registry faulted, when it named one. */
    field?: string;
  };
}

/**
 * Runs one command's work and writes its result to stdout as JSON, or its
 * failure to stderr as JSON with a non-zero exit code.
 *
 * @param work - The command's `run*` call, deferred so this owns the try/catch.
 * @returns A promise that settles once the result or the error has been
 * written. It never rejects: a failure becomes {@link JsonError} and an exit
 * code, because a caller parsing stdout should get a parseable answer either
 * way rather than a stack trace on stderr.
 *
 * @remarks
 * Results go to stdout and errors to stderr, so `skillset search --json | jq`
 * is fed only well-formed payloads and an error does not become a parse
 * failure downstream. The exit code is what distinguishes them for a caller
 * reading only one stream.
 *
 * Everything clack renders — intro, spinner, outro — is skipped by the caller
 * rather than suppressed here: those write to stdout too, and interleaving
 * them with the payload would corrupt it.
 *
 * @example
 * ```ts
 * if (jsonMode()) return emitJson(() => runInfo(deps, { name }));
 * ```
 */
export async function emitJson<T>(work: () => Promise<T>): Promise<void> {
  try {
    const result = await work();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(toJsonError(error), null, 2)}\n`);
    process.exitCode = 1;
  }
}

/**
 * Turns a caught error into the {@link JsonError} `--json` prints.
 *
 * @param error - Whatever the command threw.
 * @returns The error object, carrying the Registry's own `code`, `status` and
 * `field` when it came from the Registry.
 *
 * @remarks
 * An {@link ApiError} keeps its `code` so a caller can branch on the specific
 * failure — `skill_not_found` versus `forbidden` — rather than matching on
 * prose. Anything else is `cli_error`: the message is all there is, and
 * inventing finer codes for local failures would imply a stability that
 * nothing here guarantees.
 *
 * @example
 * ```ts
 * toJsonError(new ApiError(404, "not_found", "No such Skill."));
 * // -> { error: { code: "not_found", message: "No such Skill.", status: 404 } }
 * ```
 */
export function toJsonError(error: unknown): JsonError {
  if (error instanceof ApiError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        status: error.status,
        ...(error.field !== undefined ? { field: error.field } : {}),
      },
    };
  }
  return { error: { code: "cli_error", message: describeError(error).title } };
}
