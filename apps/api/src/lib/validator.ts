import { zValidator } from "@hono/zod-validator";
import { SkillValidationError, TagValidationError } from "@in-org-quicko/sqillset-shared";
import type { ValidationTargets } from "hono";
import { z } from "zod";
import { AppError, ValidationError } from "./errors.js";

/**
 * Turns the first failing issue into the error the API answers with.
 *
 * @remarks
 * An issue raised through `ruleSchema` carries the shared rule it broke, and
 * is answered with that rule as the code — the same response a thrown
 * `SkillValidationError` has always produced. Any other issue is a plain
 * `validation_failed`, naming the member that broke.
 */
function refusal(issues: readonly z.core.$ZodIssue[], message: string | undefined): AppError {
  const issue = issues[0];
  if (issue?.code === "custom" && typeof issue.params?.rule === "string") {
    const field: unknown = issue.params.field;
    return new AppError(400, issue.params.rule, issue.message, {
      field: typeof field === "string" ? field : undefined,
    });
  }
  const field = issue?.path.join(".");
  return new ValidationError(message ?? issue?.message ?? "Invalid request.", field || undefined);
}

/**
 * Validates one part of a request — `json`, `query`, `param`, and so on — before
 * the handler runs, exposing the parsed value as `c.req.valid(target)`.
 *
 * @remarks
 * A `json` body is only read when the request says it is JSON, so a body sent
 * as anything else is validated as `{}`. A body that claims to be JSON and
 * does not parse is refused by Hono itself, which `onError` answers as a 400.
 *
 * @param target - Which part of the request to validate.
 * @param schema - The schema it must satisfy.
 * @param message - The sentence to report instead of the schema's own. Worth
 * passing where a summary of what the route needs helps a caller more than the
 * failing issue's wording. Never replaces a shared rule's own message.
 * @returns A middleware handler.
 * @throws ValidationError if the value does not satisfy `schema`.
 * @throws AppError with a shared rule as its code, if a `ruleSchema` member fails.
 * @example
 * ```ts
 * app.post("/users", validate("json", UserCreateSchema, "first_name, last_name, email, and role are required."), (c) =>
 *   c.json(c.req.valid("json")),
 * );
 * ```
 */
export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
  message?: string,
) {
  return zValidator(target, schema, (result) => {
    if (!result.success) throw refusal(result.error.issues, message);
  });
}

/**
 * Validates a path id as a UUID, answering a malformed one as the feature's own
 * "not found".
 *
 * @remarks
 * A malformed id can never name a row, so it is refused the same way as an id
 * that names nothing — before any query runs.
 *
 * @param name - The path parameter holding the id.
 * @param notFound - Builds the error to throw for a malformed id.
 * @returns A middleware handler exposing `c.req.valid("param")[name]`.
 * @throws Whatever `notFound` returns, if the parameter is not a UUID.
 * @example
 * ```ts
 * app.patch("/:id", uuidParam("id", () => new TagNotFoundError()), (c) => c.json(c.req.valid("param").id));
 * ```
 */
export function uuidParam<Name extends string>(name: Name, notFound: () => Error) {
  const schema = z.object({ [name]: z.uuid() } as Record<Name, z.ZodUUID>);
  return zValidator("param", schema, (result) => {
    if (!result.success) throw notFound();
  });
}

/**
 * A schema member checked by one of the shared Skill or Tag rule functions.
 *
 * @remarks
 * The rules in `@in-org-quicko/sqillset-shared` are the single source of what a Skill or Tag
 * may be, and each failure names the rule it broke. Wrapping them here lets a
 * request schema reuse them unchanged, and `validate` answers a failure with
 * that rule as the error code instead of a generic `validation_failed`.
 *
 * @param check - The shared rule function; it returns the normalised value or
 * throws `SkillValidationError`/`TagValidationError`.
 * @returns A schema whose output is what `check` returns.
 * @example
 * ```ts
 * const RenameTagBody = z.object({ name: ruleSchema(validateTagName) });
 * ```
 */
export function ruleSchema<T>(check: (value: unknown) => T) {
  return z.unknown().transform((value, ctx): T => {
    try {
      return check(value);
    } catch (error) {
      if (!(error instanceof SkillValidationError || error instanceof TagValidationError)) throw error;
      ctx.addIssue({ code: "custom", message: error.message, params: { rule: error.rule, field: error.field } });
      return z.NEVER;
    }
  });
}

/**
 * Validates an already-assembled value against a schema, refusing it exactly as
 * `validate` would.
 *
 * @remarks
 * For a route that has to build the value first — merging a path parameter
 * over the body, say — and still wants the same refusal.
 *
 * @param value - The value to validate.
 * @param schema - The schema it must satisfy.
 * @param message - As `validate`.
 * @returns The parsed value, typed by `schema`.
 * @throws ValidationError if `value` does not satisfy `schema`.
 * @example
 * ```ts
 * const location = parseValue({ ...c.req.valid("json"), provider: c.req.param("provider") }, SkillSourceLocationSchema);
 * ```
 */
export function parseValue<T>(value: unknown, schema: z.ZodType<T>, message?: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw refusal(parsed.error.issues, message);
  return parsed.data;
}

/** Any JSON object, with its members left for a later schema to judge. */
export const JsonObjectSchema = z.record(z.string(), z.unknown());
