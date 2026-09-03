import type { Context } from "hono";
import type { z } from "zod";
import { ValidationError } from "./errors.js";

/**
 * Validates an already-assembled value against a schema.
 *
 * @remarks
 * The refusal every body-shaped 400 in this API comes out of. `parseBody`
 * covers the ordinary case of validating the body as it arrived; this one is
 * for a route that has to build the value first — merging a path parameter
 * over the body, say — and still wants the same refusal.
 *
 * `field` comes from the failing issue's path, so a refusal names the member
 * that broke rather than leaving a caller to guess from a sentence. A
 * refinement spanning the whole object has no path, and reports none.
 *
 * @param value - The value to validate.
 * @param schema - The schema it must satisfy.
 * @param message - The sentence to report instead of the schema's own. Worth
 * passing where the schema's default wording is less use to a caller than a
 * summary of what the route needs; omit it to report the issue's own message.
 * @returns The parsed value, typed by `schema`.
 * @throws ValidationError if `value` does not satisfy `schema`.
 * @example
 * ```ts
 * // The path wins over anything the body claims about the provider.
 * const location = parseValue({ ...body, provider: c.req.param("provider") }, SkillSourceLocationSchema);
 * ```
 */
export function parseValue<T>(value: unknown, schema: z.ZodType<T>, message?: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  const issue = parsed.error.issues[0];
  const field = issue?.path.join(".");
  throw new ValidationError(message ?? issue?.message ?? "Invalid request body.", field || undefined);
}

/**
 * Reads and validates a request body against a schema.
 *
 * @remarks
 * The single place a JSON body is read and validated in one step. A body that
 * is absent, truncated, or not JSON at all reaches the schema as `null` rather
 * than throwing, so a malformed request and a well-formed one carrying the
 * wrong shape come back as the same 400 — the distinction is not one a caller
 * can act on differently.
 *
 * @param c - The request context to read the body from.
 * @param schema - The schema the body must satisfy.
 * @param message - As `parseValue`.
 * @returns The parsed body, typed by `schema`.
 * @throws ValidationError if the body does not satisfy `schema`.
 * @example
 * ```ts
 * const input = await parseBody(c, UserCreateSchema, "first_name, last_name, email, and role are required.");
 * ```
 */
export async function parseBody<T>(c: Context, schema: z.ZodType<T>, message?: string): Promise<T> {
  return parseValue(await c.req.json().catch(() => null), schema, message);
}

/**
 * Reads a request body as a plain object of unvalidated members.
 *
 * @remarks
 * For the routes that hand individual members to a service which validates
 * them itself against the shared Skill and Tag rules — those refusals carry a
 * `rule`, and re-stating them as a schema here would put a second copy of
 * every rule in front of the one that counts.
 *
 * Anything that is not a JSON object — absent, an array, a bare string,
 * unparseable — reads as `{}`, so a member lookup on the result yields
 * `undefined` and the service refuses it as missing. That is the same outcome
 * those services already produce for a body that parsed but omitted the field.
 *
 * @param c - The request context to read the body from.
 * @returns The body's members, or an empty object.
 * @example
 * ```ts
 * const body = await readJsonObject(c);
 * const tags = await deps.tags.setSkillTags(c.req.param("id"), body.tags);
 * ```
 */
export async function readJsonObject(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}
