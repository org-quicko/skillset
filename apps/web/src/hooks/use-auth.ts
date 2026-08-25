import {
  SetupStateSchema,
  UserSchema,
  type Login,
  type SetupInit,
  type SetupState,
  type User,
} from "@skill-registry/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch } from "@/lib/api";
import { discardSessionState, meQueryKey } from "@/lib/query-keys";
import { LOGIN_PATH } from "@/lib/routes";
import { useRouter } from "@/lib/use-router";

export function useSetupState() {
  return useQuery({
    queryKey: ["setup"],
    queryFn: () => apiFetch("/setup", SetupStateSchema),
  });
}

/** Resolves to `null`, not an error, when there is no session — that's the expected shape while logged out. */
export function useCurrentUser(enabled: boolean) {
  return useQuery({
    queryKey: meQueryKey,
    enabled,
    queryFn: async (): Promise<User | null> => {
      try {
        return await apiFetch("/users/me", UserSchema, { suppressAuthReset: true });
      } catch (error) {
        if (error instanceof ApiError && error.code === "unauthenticated") return null;
        throw error;
      }
    },
  });
}

export function useSignup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SetupInit) =>
      apiFetch("/setup", UserSchema, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (user) => {
      queryClient.setQueryData(meQueryKey, user);
      queryClient.setQueryData(["setup"], { initialized: true } satisfies SetupState);
    },
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Login) =>
      apiFetch("/auth/login", UserSchema, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (user) => {
      queryClient.setQueryData(meQueryKey, user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const { navigate } = useRouter();
  return useMutation({
    mutationFn: () => apiFetch("/auth/logout", null, { method: "POST" }),
    onSuccess: () => {
      discardSessionState(queryClient);
      navigate(LOGIN_PATH);
    },
  });
}
