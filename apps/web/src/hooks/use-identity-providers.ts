import {
  IdentityProviderListSchema,
  IdentityProviderSchema,
  PublicIdentityProviderListSchema,
  type IdentityProviderCreate,
  type IdentityProviderUpdate,
} from "@skill-registry/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { identityProvidersQueryKey, loginProvidersQueryKey } from "@/lib/query-keys";

/**
 * The Identity Providers the login page should offer.
 *
 * @remarks
 * Served unauthenticated, so this runs for a visitor with no session — which
 * is the only time it matters. An instance with none configured gets an empty
 * list and the login page is exactly what it was before.
 *
 * @returns The TanStack Query result for the enabled Providers.
 */
export function useLoginProviders() {
  return useQuery({
    queryKey: loginProvidersQueryKey,
    queryFn: () => apiFetch("/auth/providers", PublicIdentityProviderListSchema),
  });
}

/**
 * Every configured Provider, enabled or not. Admin+ only — the API refuses
 * everyone else.
 *
 * @returns The TanStack Query result for the full Provider list.
 */
export function useIdentityProviders() {
  return useQuery({
    queryKey: identityProvidersQueryKey,
    queryFn: () => apiFetch("/identity-providers", IdentityProviderListSchema),
  });
}

/**
 * Configures a new Provider.
 *
 * @remarks
 * Invalidates the login page's list as well as the Admin's: creating a
 * Provider enabled adds a button every visitor sees.
 */
export function useCreateIdentityProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: IdentityProviderCreate) =>
      apiFetch("/identity-providers", IdentityProviderSchema, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: identityProvidersQueryKey });
      void queryClient.invalidateQueries({ queryKey: loginProvidersQueryKey });
    },
  });
}

/**
 * Changes a Provider's configuration, including enabling and disabling it.
 *
 * @remarks
 * Omitting `client_secret` from the body leaves the stored one untouched,
 * which is how a Provider is edited without its secret ever being read back.
 */
export function useUpdateIdentityProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: IdentityProviderUpdate }) =>
      apiFetch(`/identity-providers/${id}`, IdentityProviderSchema, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: identityProvidersQueryKey });
      void queryClient.invalidateQueries({ queryKey: loginProvidersQueryKey });
    },
  });
}
