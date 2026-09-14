/**
 * The row a write was supposed to return.
 *
 * @remarks
 * Every `insert`/`update` in this codebase ends in `.returning()`, which types
 * its result as an array however certain the statement is to produce exactly
 * one row. Destructuring leaves a `Row | undefined` that has to be narrowed
 * before use, and each service was narrowing it with its own hand-written
 * `throw new Error(...)`.
 *
 * Deliberately a plain `Error` and not an `AppError`: reaching it means a
 * statement that must have written a row did not, which is a bug rather than a
 * refusal, and the central handler turns it into the 500 it is. A caller for
 * whom the empty case is a real outcome — "no such row to update" — must test
 * for it and throw its own domain error instead of calling this.
 *
 * @param rows - What `.returning()` gave back.
 * @param what - The statement, named for the message: "Connection upsert"
 * reads out as "Connection upsert did not return a row."
 * @returns The first row.
 * @throws Error if `rows` is empty.
 * @example
 * ```ts
 * const created = firstRow(await this.db.insert(tokens).values(input).returning(), "Token insert");
 * ```
 */
export function firstRow<T>(rows: T[], what: string): T {
  const [row] = rows;
  if (row === undefined) throw new Error(`${what} did not return a row.`);
  return row;
}
