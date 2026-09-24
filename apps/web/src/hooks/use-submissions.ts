import { ResourceSubmissionListSchema, SkillSchema } from "@in-org-quicko/skillset-shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { resourcesQueryKey, submissionsQueryKey } from "@/lib/query-keys";

/**
 * Every pending Resource Submission, newest first (ADR-0044). Admin+ only —
 * the API refuses everyone else.
 */
export function useSubmissions() {
  return useQuery({
    queryKey: submissionsQueryKey,
    queryFn: () => apiFetch("/submissions", ResourceSubmissionListSchema),
  });
}

/**
 * Approves a Submission into the Registry — `POST /submissions/{id}/approve`.
 *
 * @remarks
 * Invalidates every cached Resource as well as the Submission list: approving
 * adds a row to the catalog, its stats, and whatever search is on screen.
 */
export function useApproveSubmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/submissions/${encodeURIComponent(id)}/approve`, SkillSchema, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: submissionsQueryKey });
      void queryClient.invalidateQueries({ queryKey: resourcesQueryKey });
    },
  });
}

/** Rejects a Submission, discarding it and its files — `DELETE /submissions/{id}`. */
export function useRejectSubmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/submissions/${encodeURIComponent(id)}`, null, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: submissionsQueryKey });
    },
  });
}
