import { SkillTagsSchema, TagListSchema, TagSchema } from "@skill-registry/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { skillQueryKey, skillsListQueryKey, tagsListQueryKey } from "@/lib/query-keys";

/**
 * Fetches the whole Tag catalog — what a Skill's tag editor filters against
 * while typing (ADR-0011). Registry-wide, not scoped to any one Skill.
 *
 * @returns The TanStack Query result for the catalog, alphabetical by name.
 */
export function useTags() {
  return useQuery({
    queryKey: tagsListQueryKey,
    queryFn: () => apiFetch("/tags", TagListSchema),
  });
}

/**
 * Replaces a Skill's Tags wholesale, by name — `PUT /skills/{id}/tags`. A
 * full replace, not incremental: pass the entire desired set every time.
 *
 * @remarks
 * On success, writes the resolved Tags straight into the Skill's own cache
 * entry (no refetch needed to see them) and invalidates the Tag catalog,
 * since a name with no existing match creates a new one (find-or-create).
 * The Skill list is invalidated too, even though it doesn't render tags
 * today (a deliberately deferred follow-up) — its cached rows still carry a
 * `tags` field, and this keeps it correct rather than stale.
 */
export function useSetSkillTags() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tags }: { id: string; name: string; tags: string[] }) =>
      apiFetch(`/skills/${encodeURIComponent(id)}/tags`, SkillTagsSchema, {
        method: "PUT",
        body: JSON.stringify({ tags }),
      }),
    onSuccess: (result, { name }) => {
      queryClient.setQueryData(skillQueryKey(name), (skill: unknown) =>
        skill && typeof skill === "object" ? { ...skill, tags: result.tags } : skill,
      );
      queryClient.invalidateQueries({ queryKey: tagsListQueryKey });
      queryClient.invalidateQueries({ queryKey: skillsListQueryKey });
    },
  });
}

/**
 * Renames a Tag in place — `PATCH /tags/{id}`. `admin` only; the API refuses
 * everyone else, since a rename reaches every Skill carrying this Tag, not
 * just the one currently open (ADR-0011).
 *
 * @remarks
 * Invalidates every cached Skill (list and detail alike), not just the one
 * the rename was triggered from — the renamed Tag may appear on Skills
 * nowhere near what's currently in view, and there's no client-side index
 * of which ones to target individually.
 */
export function useRenameTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiFetch(`/tags/${encodeURIComponent(id)}`, TagSchema, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tagsListQueryKey });
      queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
