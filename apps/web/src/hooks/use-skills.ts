import {
  buildSkillBundle,
  SkillPageSchema,
  SkillPublishedSchema,
  SkillSchema,
  type Skill,
  type SkillFile,
} from "@skill-registry/shared";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { skillQueryKey, skillsListQueryKey, skillsQueryKey } from "@/lib/query-keys";

export function useSkills(page: number) {
  return useQuery({
    queryKey: skillsQueryKey(page),
    queryFn: () => apiFetch(`/skills?page=${page}`, SkillPageSchema),
    placeholderData: keepPreviousData,
  });
}

export function useSkill(name: string) {
  return useQuery({
    queryKey: skillQueryKey(name),
    queryFn: () => apiFetch(`/skills/${encodeURIComponent(name)}`, SkillSchema),
    // A publish already writes this exact response into the cache
    // (usePublishSkill's onSuccess) — avoid an immediate, redundant refetch
    // of what was just returned when the reader lands straight on it.
    staleTime: 30_000,
  });
}

/** A failed upload's only recovery is retrying the publish — it replaces rather than duplicates. */
export class SkillUploadError extends Error {
  constructor() {
    super("The upload failed. Retrying the publish will replace it, not duplicate it.");
    this.name = "SkillUploadError";
  }
}

/**
 * Validates and builds the Artifact locally (`buildSkillBundle`, the same
 * pipeline the CLI and the API's own checks use), publishes the metadata,
 * then uploads the Artifact straight to storage (ADR-0001). The Skill list
 * is only invalidated once the upload has finished — never while it is in
 * flight.
 */
export function usePublishSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (files: SkillFile[]): Promise<Skill> => {
      const bundle = buildSkillBundle(files);

      const published = await apiFetch(`/skills/${encodeURIComponent(bundle.name)}`, SkillPublishedSchema, {
        method: "PUT",
        body: JSON.stringify({ description: bundle.description, body: bundle.body }),
      });

      const upload = await fetch(published.upload.url, {
        method: published.upload.method,
        headers: published.upload.headers,
        // `zipSync` types its result as backed by `ArrayBufferLike`, which
        // `BlobPart` doesn't accept directly — re-wrapping narrows it to a
        // concrete `ArrayBuffer`-backed view.
        body: new Blob([new Uint8Array(bundle.artifact)]),
      });
      if (!upload.ok) throw new SkillUploadError();

      return published.skill;
    },
    onSuccess: (skill) => {
      queryClient.invalidateQueries({ queryKey: skillsListQueryKey });
      queryClient.setQueryData(skillQueryKey(skill.name), skill);
    },
  });
}
