import type { QueryClient } from "@tanstack/react-query";

/** The identity query every "am I logged in" check and auth transition reads and writes. */
export const meQueryKey = ["me"] as const;

/** A User's own Tokens. Discarded with the rest of the cache when a session ends. */
export const tokensQueryKey = ["tokens"] as const;

/** One page of the Skill list. A shared prefix so publishing can invalidate every page at once. */
export const skillsListQueryKey = ["skills", "list"] as const;
export function skillsQueryKey(page: number) {
  return [...skillsListQueryKey, page] as const;
}

/** A single Skill, with its `SKILL.md` body. */
export function skillQueryKey(name: string) {
  return ["skills", "detail", name] as const;
}

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
