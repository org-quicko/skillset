import {
  SetupStateSchema,
  UserSchema,
  type Login,
  type SetupInit,
  type SetupState,
  type User,
} from "@skillset/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
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

/**
 * Signs in with a password through Better Auth, then reads the User back from
 * the Registry.
 *
 * @remarks
 * The second step is not redundant. Better Auth's response describes its own
 * session user, which carries no role; `/users/me` is what the rest of the
 * interface consumes, and its role is resolved from the database on every
 * request (ADR-0005). So this signs in, then asks the Registry who that turned
 * out to be.
 */
export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: Login): Promise<User> => {
      const { error } = await authClient.signIn.email({
        email: body.email,
        password: body.password,
      });
      if (error) {
        // 401, matching what the API answers for a rejected credential —
        // Better Auth's client reports the failure without one, and every
        // `ApiError` carries the status its callers branch on.
        throw new ApiError(401, "invalid_credentials", "Email or password is incorrect.");
      }
      return apiFetch("/users/me", UserSchema, { suppressAuthReset: true });
    },
    onSuccess: (user) => {
      queryClient.setQueryData(meQueryKey, user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const { navigate } = useRouter();
  return useMutation({
    // Revokes the session server-side rather than only clearing a cookie —
    // sessions are rows now (ADR-0016).
    mutationFn: () => authClient.signOut(),
    onSuccess: () => {
      discardSessionState(queryClient);
      navigate(LOGIN_PATH);
    },
  });
}
