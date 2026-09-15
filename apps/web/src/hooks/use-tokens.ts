import {
  TokenCreatedSchema,
  TokenSchema,
  type Token,
  type TokenCreated,
  type TokenMint,
} from "@in-org-quicko/sqillset-shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "@/lib/api";
import { tokensQueryKey } from "@/lib/query-keys";

export function useTokens() {
  return useQuery({
    queryKey: tokensQueryKey,
    queryFn: () => apiFetch("/users/me/tokens", z.array(TokenSchema)),
  });
}

/**
 * The minted secret is handed straight to `onMinted` and never reaches the
 * cache: what this mutation retains is the listable Token, parsed back
 * through `TokenSchema`, which has no `secret` field. A Token is shown
 * exactly once, so the only copy lives in the caller's component state
 * until it unmounts.
 */
export function useMintToken(onMinted: (token: TokenCreated) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: TokenMint): Promise<Token> => {
      const created = await apiFetch("/users/me/tokens", TokenCreatedSchema, {
        method: "POST",
        body: JSON.stringify(body),
      });
      onMinted(created);
      return TokenSchema.parse(created);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tokensQueryKey }),
  });
}

export function useRevokeToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => apiFetch(`/users/me/tokens/${tokenId}`, null, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tokensQueryKey }),
  });
}
