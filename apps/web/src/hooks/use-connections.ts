import { ConnectionListSchema, RepositoryListSchema } from "@skillset/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { connectionsQueryKey, repositoriesQueryKey } from "@/lib/query-keys";

/**
 * The caller's own Connections, and the Git Providers they could connect.
 *
 * @remarks
 * `writer`+ only — the API refuses a reader, which is deliberate: Importing
 * exists to publish, so a reader must not be invited to grant a credential
 * they could never use (ADR-0024).
 *
 * Both halves come from one request because the card always needs both at
 * once: "connected as ada-work" and "connect GitHub" are the same card in two
 * states, and fetching them separately would render the wrong one first.
 *
 * @returns The TanStack Query result for `{ items, connectable }`.
 */
export function useConnections() {
  return useQuery({
    queryKey: connectionsQueryKey,
    queryFn: () => apiFetch("/connections", ConnectionListSchema),
  });
}

/**
 * Withdraws the Registry's use of one Connection.
 *
 * @remarks
 * Registry-local, and the copy around this must say so: it stops *this
 * Registry* using the grant and does not withdraw it at the provider. If the
 * interface ever says "revoked" without that qualification, the product and
 * ADR-0024 disagree, and the ADR is right.
 *
 * @returns The TanStack Query mutation, taking the provider to disconnect.
 */
export function useDisconnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) => apiFetch(`/connections/${provider}`, null, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: connectionsQueryKey }),
  });
}

/**
 * Where to send the browser to grant, or re-grant, repository access.
 *
 * @remarks
 * A full navigation rather than a `fetch`: the route answers 302 to the
 * provider's authorize endpoint, and following that is the browser's job. It is
 * also why this is a URL a link or `window.location` uses and not a mutation.
 *
 * Serves connecting and reconnecting, which are the same trip. It does **not**
 * serve choosing repositories — that is `manage_access_url` on the provider's
 * `connectable` entry, and sending someone here instead would complete an
 * authorization that changes nothing about what the app can see (ADR-0024).
 *
 * @param provider - The Git Provider to connect.
 * @param integrationId - Which Integration (app) to connect through, when the
 * provider has more than one (ADR-0025). Omit when it has exactly one.
 * @returns The absolute path to navigate to.
 * @example
 * ```tsx
 * <a href={connectHref("github", integration.id)}>Connect GitHub</a>
 * ```
 */
export function connectHref(provider: string, integrationId?: string): string {
  const query = integrationId ? `?integration_id=${integrationId}` : "";
  return `/api/connections/${provider}/start${query}`;
}

/**
 * Every repository a writer's Connection to a Git Provider can see — the
 * picker behind "browse repositories" on the publish screen, so a writer
 * never has to know a project's URL by heart.
 *
 * @param provider - The Git Provider to list from.
 * @param enabled - Whether to run the query at all. Pass `false` while the
 * writer has not yet been shown to hold a Connection — asking otherwise would
 * spend a request on a `not_connected` refusal the caller already knows to
 * expect from `useConnections`.
 * @returns The TanStack Query result for `{ items }`.
 */
export function useRepositories(provider: string, enabled: boolean) {
  return useQuery({
    queryKey: repositoriesQueryKey(provider),
    queryFn: () => apiFetch(`/imports/${provider}/repositories`, RepositoryListSchema),
    enabled,
  });
}
