import {
  IntegrationListSchema,
  IntegrationSchema,
  type IntegrationCreate,
  type IntegrationUpdate,
} from "@skillset/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { connectionsQueryKey, integrationsQueryKey } from "@/lib/query-keys";

/**
 * Every configured Integration. Admin+ only — the API refuses everyone else.
 *
 * @remarks
 * There is no public counterpart, unlike Identity Providers: an Integration
 * draws no button on an unauthenticated page. What a *writer* is allowed to
 * know is which providers are connectable, and that comes from
 * `useConnections` instead.
 *
 * @returns The TanStack Query result for the full Integration list.
 */
export function useIntegrations() {
  return useQuery({
    queryKey: integrationsQueryKey,
    queryFn: () => apiFetch("/integrations", IntegrationListSchema),
  });
}

/**
 * Registers a Git Provider with this Registry.
 *
 * @remarks
 * Also invalidates the Connections query, because creating an Integration is
 * what makes a provider connectable — a writer's card has to grow a Connect
 * button, and nothing else would tell it to.
 */
export function useCreateIntegration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: IntegrationCreate) =>
      apiFetch("/integrations", IntegrationSchema, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: integrationsQueryKey });
      void queryClient.invalidateQueries({ queryKey: connectionsQueryKey });
    },
  });
}

/**
 * Changes an Integration's configuration.
 *
 * @remarks
 * Omitting `client_secret` from the body leaves the stored one untouched,
 * which is how an Integration is edited without its secret ever being read
 * back — no response carries it, so the interface could not show it anyway.
 */
export function useUpdateIntegration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: IntegrationUpdate }) =>
      apiFetch(`/integrations/${id}`, IntegrationSchema, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: integrationsQueryKey });
      void queryClient.invalidateQueries({ queryKey: connectionsQueryKey });
    },
  });
}

/**
 * Removes an Integration's registration with a Git Provider.
 *
 * @remarks
 * Refused (409) while a writer still holds a Connection through it — the API
 * enforces this, not the interface, so the dialog calling this only needs to
 * show whatever message comes back. Also invalidates the Connections query:
 * removing an Integration is what makes a provider no longer connectable
 * through it.
 */
export function useDeleteIntegration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/integrations/${id}`, null, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: integrationsQueryKey });
      void queryClient.invalidateQueries({ queryKey: connectionsQueryKey });
    },
  });
}
