import {
  UserCreatedSchema,
  UserPageSchema,
  UserSchema,
  type AssignableRole,
  type User,
  type UserCreated,
} from "@skillset/shared";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { meQueryKey, usersListQueryKey, usersQueryKey } from "@/lib/query-keys";

/**
 * Fetches one page of the User list. Admin+ only — the API refuses everyone
 * else.
 *
 * @param page - The 1-indexed page number to fetch.
 * @returns The TanStack Query result for that page's `UserPage`.
 */
export function useUsers(page: number) {
  return useQuery({
    queryKey: usersQueryKey(page),
    queryFn: () => apiFetch(`/users?page=${page}`, UserPageSchema),
    placeholderData: keepPreviousData,
  });
}

/**
 * Creates a User with a generated initial password. The password is handed
 * straight to `onCreated` and never reaches the cache — like a minted Token,
 * it's shown exactly once.
 */
export function useCreateUser(onCreated: (created: UserCreated) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      first_name: string;
      last_name: string;
      email: string;
      role: AssignableRole;
    }): Promise<void> => {
      const created = await apiFetch("/users", UserCreatedSchema, {
        method: "POST",
        body: JSON.stringify(body),
      });
      onCreated(created);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersListQueryKey }),
  });
}

/** Takes effect on that User's next request (docs/adr/0005) — no re-login needed. */
export function useUpdateUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: AssignableRole }) =>
      apiFetch(`/users/${userId}`, UserSchema, { method: "PATCH", body: JSON.stringify({ role }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersListQueryKey }),
  });
}

/** Skills the removed User published remain, attributed by their email snapshot. */
export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => apiFetch(`/users/${userId}`, null, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersListQueryKey }),
  });
}

/** Corrects the caller's own first and/or last name. */
export function useUpdateOwnName() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { first_name?: string; last_name?: string }) =>
      apiFetch("/users/me", UserSchema, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (user: User) => queryClient.setQueryData(meQueryKey, user),
  });
}

/** Replaces the caller's own password. Also how a generated initial password gets replaced. */
export function useReplaceOwnPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { current_password: string; new_password: string }) =>
      apiFetch("/users/me/password", null, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: meQueryKey }),
  });
}
