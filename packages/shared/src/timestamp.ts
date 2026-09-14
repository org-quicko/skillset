import { z } from "zod";

/**
 * Accepts either a `Date` (a raw database row, server-side) or an ISO string
 * (an already-serialized wire payload, client-side) and normalises to an
 * ISO string either way. One schema works on both sides of the wire, so
 * shaping a response is `Schema.parse(row)` rather than a hand-written
 * mapping function.
 */
export const timestamp = z.union([z.date(), z.string()]).transform((value) =>
  value instanceof Date ? value.toISOString() : value,
);
