import {
  isKind,
  KIND_KEYS,
  SKILL_DIRECTORY_DEFAULT_PAGE_SIZE,
  SKILL_DIRECTORY_MAX_PAGE_SIZE,
  SKILL_DIRECTORY_MIN_PAGE_SIZE,
  SKILL_DIRECTORY_SORT_FIELDS,
  SKILL_DIRECTORY_SORT_ORDERS,
} from "@skillset/shared";
import type { Context } from "hono";
import { z } from "zod";
import { parseValue } from "./body.js";

/** Reused rather than rebuilt per element — the `tag_id` filter below runs it over every value. */
const Uuid = z.uuid();

/**
 * A page below 1, or not a number at all, is the first page rather than a
 * refusal: a stale bookmark or a hand-edited URL should show a reader
 * something.
 */
const PageNumber = z.coerce.number().int().min(1).catch(1);

/**
 * Clamped rather than refused, unlike `sort_by`/`sort_order` (ticket 23), and
 * anything not a whole number falls back to the default. The ceiling is what
 * stops a caller asking for the whole table in one request.
 */
const PageSize = z.coerce
  .number()
  .int()
  .catch(SKILL_DIRECTORY_DEFAULT_PAGE_SIZE)
  .transform((size) => Math.min(SKILL_DIRECTORY_MAX_PAGE_SIZE, Math.max(SKILL_DIRECTORY_MIN_PAGE_SIZE, size)));

/** A blank or all-whitespace search term is no search term at all. */
const SearchTerm = z
  .string()
  .optional()
  .transform((raw) => {
    const trimmed = raw?.trim();
    return trimmed ? trimmed : undefined;
  });

/**
 * Malformed ids are dropped rather than rejecting the whole request over one
 * bad value — `tag_id` is repeatable, and a caller sending three good ones and
 * a typo is better served by the three.
 *
 * @remarks
 * Filtered here rather than left to Postgres: a non-UUID reaching a `tags.id`
 * comparison raises 22P02, which is a 500 for what is really a narrowing hint.
 */
const TagIds = z
  .array(z.string())
  .optional()
  .transform((ids) => (ids ?? []).filter((id) => Uuid.safeParse(id).success));

/**
 * `?kind=`, refusing an unrecognised value the same way `sort_by` does
 * (ADR-0026) — `isKind` checks against the one list of registered Kinds
 * (`KINDS` in shared), same treatment `git-provider.ts` gives `provider`.
 * Absent means no Kind filter at all, not "no Resources".
 */
const Kind = z
  .string()
  .refine(isKind, { message: `kind must be one of: ${KIND_KEYS.join(", ")}.` })
  .optional();

/**
 * `GET /resources`'s query string, as the Resources service needs it.
 *
 * @remarks
 * Keyed by the wire's own names, so a refusal's `field` says `sort_by` rather
 * than the camelCase the service reads — then mapped over in one transform, so
 * the service never sees a raw string again.
 *
 * The enums (`kind`, `sort_by`, `sort_order`) refuse an unrecognised value
 * while everything else falls back to a default. That split is deliberate
 * (ticket 23): a bad `page` still has an obvious right answer, while a bad
 * `sort_by` does not, and quietly sorting by something else is worse than
 * saying so.
 */
const ResourceDirectoryQuerySchema = z
  .object({
    page: PageNumber,
    page_size: PageSize,
    q: SearchTerm,
    kind: Kind,
    tag_id: TagIds,
    sort_by: z
      .enum(SKILL_DIRECTORY_SORT_FIELDS, {
        error: `sort_by must be one of: ${SKILL_DIRECTORY_SORT_FIELDS.join(", ")}.`,
      })
      // ADR-0028: installs are not comparable across Kinds, so the default
      // listing no longer orders by them — updated_at does.
      .default("updated_at"),
    sort_order: z
      .enum(SKILL_DIRECTORY_SORT_ORDERS, {
        error: `sort_order must be one of: ${SKILL_DIRECTORY_SORT_ORDERS.join(", ")}.`,
      })
      .default("desc"),
  })
  .transform((query) => ({
    page: query.page,
    pageSize: query.page_size,
    q: query.q,
    kind: query.kind,
    tagIds: query.tag_id,
    sortBy: query.sort_by,
    sortOrder: query.sort_order,
  }));

/** A validated, fully-typed `GET /resources` query. */
export type ResourceDirectoryQuery = z.infer<typeof ResourceDirectoryQuerySchema>;

/**
 * Reads and validates `GET /resources`'s query string.
 *
 * @remarks
 * The Resources service used to take these as raw strings and parse them
 * itself, which put HTTP's own concerns — coercion, defaults, and which bad
 * value is worth a 400 — inside the domain layer, and left `list` unable to be
 * called with anything a caller could be sure was valid.
 *
 * `tag_id` is read with `queries`, not `query`: it is repeatable, and `query`
 * would silently keep only the first.
 *
 * @param c - The request whose query string to read.
 * @returns The query, coerced and defaulted.
 * @throws ValidationError if `kind`, `sort_by`, or `sort_order` is present and
 * not a recognised value.
 * @example
 * ```ts
 * // GET /resources?q=review&kind=skill&tag_id=<id>&sort_by=updated_at&page=2
 * const page = await deps.resources.list(parseResourceDirectoryQuery(c));
 * ```
 */
export function parseResourceDirectoryQuery(c: Context): ResourceDirectoryQuery {
  return parseValue(
    {
      page: c.req.query("page"),
      page_size: c.req.query("page_size"),
      q: c.req.query("q"),
      kind: c.req.query("kind"),
      tag_id: c.req.queries("tag_id"),
      sort_by: c.req.query("sort_by"),
      sort_order: c.req.query("sort_order"),
    },
    ResourceDirectoryQuerySchema,
  );
}
