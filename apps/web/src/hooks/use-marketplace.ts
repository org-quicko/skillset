import {
  MarketplaceSettingsSchema,
  type MarketplaceSettingsUpdate,
} from "@in-org-quicko/skillset-shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { marketplaceSettingsQueryKey } from "@/lib/query-keys";

/** The Claude Code marketplace's name, owner, and description. Admin+ only — the API refuses everyone else. */
export function useMarketplaceSettings() {
  return useQuery({
    queryKey: marketplaceSettingsQueryKey,
    queryFn: () => apiFetch("/marketplace/settings", MarketplaceSettingsSchema),
  });
}

/** Replaces the Claude Code marketplace's details, and caches what was saved. */
export function useUpdateMarketplaceSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: MarketplaceSettingsUpdate) =>
      apiFetch("/marketplace/settings", MarketplaceSettingsSchema, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: (settings) => queryClient.setQueryData(marketplaceSettingsQueryKey, settings),
  });
}
