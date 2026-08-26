import type { QueryClient } from "@tanstack/react-query";

/** The identity query every "am I logged in" check and auth transition reads and writes. */
export const meQueryKey = ["me"] as const;

/** A User's own Tokens. Discarded with the rest of the cache when a session ends. */
export const tokensQueryKey = ["tokens"] as const;

/** One page of the Skill list. A shared prefix so publishing can invalidate every page at once. */
export const skillsListQueryKey = ["skills", "list"] as const;

/**
 * Keys one page of the Skill list, optionally narrowed by a search term.
 *
 * The term is part of the key — not just the URL — so switching between
 * search terms and paging within one are cached as distinct entries, and
 * TanStack Query's `placeholderData: keepPreviousData` (see `useSkills`)
 * keeps showing the previous term's results while a new term's request is
 * still in flight instead of the list emptying out.
 *
 * @param page - The 1-indexed page number.
 * @param q - The search term, or `""` for the ordinary unfiltered list.
 * @returns A query key rooted at {@link skillsListQueryKey}, so invalidating
 * that shared prefix still invalidates every term/page combination.
 * @example
 * skillsQueryKey(1, "code review") // => ["skills", "list", "code review", 1]
 */
export function skillsQueryKey(page: number, q: string) {
  return [...skillsListQueryKey, q, page] as const;
}

/** A single Skill, with its `SKILL.md` body. */
export function skillQueryKey(name: string) {
  return ["skills", "detail", name] as const;
}

/** The whole Tag catalog — what a tag editor's autocomplete filters against. */
export const tagsListQueryKey = ["tags", "list"] as const;

/** One page of the User list. A shared prefix so any mutation can invalidate every page at once. */
export const usersListQueryKey = ["users", "list"] as const;

/**
 * Keys one page of the User list.
 *
 * @param page - The 1-indexed page number.
 * @returns A query key rooted at {@link usersListQueryKey}.
 */
export function usersQueryKey(page: number) {
  return [...usersListQueryKey, page] as const;
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
