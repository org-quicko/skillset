import type { QueryClient } from "@tanstack/react-query";

/** The identity query every "am I logged in" check and auth transition reads and writes. */
export const meQueryKey = ["me"] as const;

/**
 * Ends a session in the query cache: every other cached resource is
 * discarded, and the identity query is set to `null` directly rather than
 * removed. `removeQueries`/`clear()` destroy a query's cache entry even
 * while it has an active observer (the mounted `useCurrentUser` call), which
 * orphans that observer from a freshly rebuilt, unobserved entry and the UI
 * never re-renders. Writing through `setQueryData` instead updates the
 * live entry in place, which is what the still-mounted observer sees.
 */
export function discardSessionState(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== meQueryKey[0] });
  queryClient.setQueryData(meQueryKey, null);
}
