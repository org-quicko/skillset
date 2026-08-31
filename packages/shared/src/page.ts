/**
 * One page of a listed resource.
 *
 * @remarks
 * Every paginated response carries the page it is, the size it was capped at,
 * and the total number of matches — a caller cannot derive the last two from
 * `items` alone. `page_size` is the size actually applied, which for a
 * clamped parameter is not necessarily the size requested.
 */
export interface Page<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}
