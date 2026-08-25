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

/**
 * Fetches one page of the Skill list, optionally narrowed by a full-text
 * search term.
 *
 * `q` rides the query key (`skillsQueryKey`), so a new term gets its own
 * cache entry rather than overwriting the previous one; `keepPreviousData`
 * keeps rendering that previous entry's results while the new term's request
 * is in flight, instead of the list emptying out mid-search.
 *
 * @param page - The 1-indexed page number to fetch.
 * @param q - The search term, or `""` for the ordinary most-recent-first
 * list. Supports quoted phrases and `-exclusions` (docs/adr/0004).
 * @returns The TanStack Query result for that page's `SkillPage`.
 * @example
 * const skills = useSkills(1, '"code review" -legacy');
 */
export function useSkills(page: number, q: string) {
  return useQuery({
    queryKey: skillsQueryKey(page, q),
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (q) params.set("q", q);
      return apiFetch(`/skills?${params.toString()}`, SkillPageSchema);
    },
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
        // The optional fields are `undefined` on `bundle` when the SKILL.md
        // never set them, and JSON.stringify drops undefined-valued keys —
        // so only the ones the frontmatter actually set are sent.
        body: JSON.stringify({
          description: bundle.description,
          body: bundle.body,
          license: bundle.license,
          compatibility: bundle.compatibility,
          metadata: bundle.metadata,
          allowed_tools: bundle.allowed_tools,
        }),
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

/** Irreversible (spec, ticket 12) — Admin-only, and the API refuses everyone else. */
export function useDeleteSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => apiFetch(`/skills/${encodeURIComponent(name)}`, null, { method: "DELETE" }),
    onSuccess: (_data, name) => {
      queryClient.invalidateQueries({ queryKey: skillsListQueryKey });
      queryClient.removeQueries({ queryKey: skillQueryKey(name) });
    },
  });
}
