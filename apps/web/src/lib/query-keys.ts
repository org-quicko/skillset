import type { QueryClient } from "@tanstack/react-query";

/** The identity query every "am I logged in" check and auth transition reads and writes. */
export const meQueryKey = ["me"] as const;

/** A User's own Tokens. Discarded with the rest of the cache when a session ends. */
export const tokensQueryKey = ["tokens"] as const;

/** One page of the Skill list. A shared prefix so publishing can invalidate every page at once. */
export const skillsListQueryKey = ["skills", "list"] as const;

/**
 * Keys the infinite Skill directory query for one filter/sort combination
 * (ticket 23).
 *
 * Every filter is part of the key — not just the URL — so switching between
 * search terms, Tag filters, or sort choices is cached as a distinct entry
 * (each with its own accumulated pages), rather than one entry's pages being
 * reused for a completely different query. `tagIds` is sorted first so the
 * same set of Tags in a different pick order still hits the same entry.
 *
 * @param filters - The search term, selected Tag ids, and sort choice.
 * @returns A query key rooted at {@link skillsListQueryKey}, so invalidating
 * that shared prefix still invalidates every filter/sort combination.
 * @example
 * skillDirectoryQueryKey({ q: "code review", tagIds: [], sortBy: "installs", sortOrder: "desc" })
 * // => ["skills", "list", "code review", [], "installs", "desc"]
 */
export function skillDirectoryQueryKey(filters: {
  q: string;
  tagIds: string[];
  sortBy: string;
  sortOrder: string;
}) {
  return [
    ...skillsListQueryKey,
    filters.q,
    [...filters.tagIds].sort(),
    filters.sortBy,
    filters.sortOrder,
  ] as const;
}

/** A single Skill, with its `SKILL.md` body. */
export function skillQueryKey(name: string) {
  return ["skills", "detail", name] as const;
}

/** The Skill directory's hero stats — unfiltered, unlike `skillsListQueryKey`'s pages. */
export const skillStatsQueryKey = ["skills", "stats"] as const;

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
 * The caller's own Connections, and what they could connect.
 *
 * Discarded with the rest of the cache when a session ends, like Tokens: a
 * Connection is one person's grant and means nothing to the next session.
 */
export const connectionsQueryKey = ["connections"] as const;

/** Every configured Integration — an Admin's view. There is no public counterpart. */
export const integrationsQueryKey = ["integrations"] as const;

/** Every configured Identity Provider — an Admin's view, including disabled ones. */
export const identityProvidersQueryKey = ["identity-providers"] as const;

/**
 * The Identity Providers the login page offers. A separate key from
 * {@link identityProvidersQueryKey} because it is a different resource, not a
 * filtered view of one: it is served unauthenticated, carries only what a
 * button needs, and is read by visitors who have no session at all.
 */
export const loginProvidersQueryKey = ["auth", "providers"] as const;

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
