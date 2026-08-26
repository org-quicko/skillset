import { z } from "zod";

/**
 * Whether `id` is a well-formed UUID.
 *
 * @remarks
 * A malformed id can never match a row — every id-keyed lookup across the
 * Skills and Tags services treats a `false` result the same as "not found"
 * rather than letting an invalid UUID reach Postgres as a raw query error.
 *
 * @param id - The candidate id.
 * @returns `boolean`
 * @example
 * ```ts
 * isWellFormedId("not-a-uuid"); // false
 * ```
 */
export function isWellFormedId(id: string): boolean {
  return z.uuid().safeParse(id).success;
}
