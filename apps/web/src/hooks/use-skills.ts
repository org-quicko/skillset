import {
  buildSkillBundle,
  SkillDirectoryPageSchema,
  SkillPublishedSchema,
  SkillSchema,
  SkillWithArtifactUrlSchema,
  type Skill,
  type SkillDirectorySortField,
  type SkillDirectorySortOrder,
  type SkillFile,
} from "@skill-registry/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { skillDirectoryQueryKey, skillQueryKey, skillsListQueryKey } from "@/lib/query-keys";

export interface SkillDirectoryFilters {
  /** Trimmed before use; blank is treated as no search term. */
  q: string;
  tagIds: string[];
  sortBy: SkillDirectorySortField;
  sortOrder: SkillDirectorySortOrder;
}

/**
 * Fetches the Skill directory (ticket 23) as an infinite, scroll-loaded list,
 * optionally narrowed by a full-text search term and one or more Tags, and
 * sorted by install count or last-updated.
 *
 * @remarks
 * Every filter rides the query key (`skillDirectoryQueryKey`), so changing
 * the search term, Tag filter, or sort choice starts a fresh accumulation of
 * pages from page 1 rather than appending to, or reusing, a previous
 * combination's pages — matching the requirement that changing any of them
 * resets the list. `page_size` is left to the API's own default; nothing
 * here exposes a control for it (out of scope, ticket 23).
 *
 * @param filters - The search term, selected Tag ids, and sort choice —
 * normally the URL's own query-string state (see `SkillsPanel`).
 * @returns The TanStack Query infinite-query result. `data.pages` is one
 * `SkillDirectoryPage` per page fetched so far; call `fetchNextPage()` to
 * load another once `hasNextPage` is true.
 * @example
 * const skills = useSkillDirectory({ q: "", tagIds: [], sortBy: "installs", sortOrder: "desc" });
 */
export function useSkillDirectory(filters: SkillDirectoryFilters) {
  return useInfiniteQuery({
    queryKey: skillDirectoryQueryKey(filters),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        page: String(pageParam),
        sort_by: filters.sortBy,
        sort_order: filters.sortOrder,
      });
      if (filters.q) params.set("q", filters.q);
      for (const tagId of filters.tagIds) params.append("tag_id", tagId);
      return apiFetch(`/skills?${params.toString()}`, SkillDirectoryPageSchema);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.page * lastPage.page_size;
      return loaded < lastPage.total ? lastPage.page + 1 : undefined;
    },
  });
}

/**
 * Fetches a single Skill by name — the browser URL is always `/skills/<name>`
 * (ADR-0002's flat identity is still what a person types or bookmarks), and
 * `GET /skills/by-name/<name>` returns the same full Skill shape reading by
 * `id` would (ticket 16), so there's no separate id lookup to do first: an
 * indexed lookup on the unique `name` column is exactly as cheap as one on
 * the `id` primary key. `id` itself is only needed once the Skill is already
 * in hand, for the Delete and Download actions (`skill.id` off this query's
 * result) — see `useDeleteSkill` and `useDownloadSkillArtifact`.
 *
 * @param name - The Skill's name, from the `/skills/<name>` URL.
 * @returns The TanStack Query result for that Skill.
 * @throws ApiError with code `"not_found"` if no Skill exists by that name.
 */
export function useSkill(name: string) {
  return useQuery({
    queryKey: skillQueryKey(name),
    queryFn: () => apiFetch(`/skills/by-name/${encodeURIComponent(name)}`, SkillSchema),
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

/**
 * Deletes a Skill by id. Irreversible (spec, ticket 12) — Admin-only, and
 * the API refuses everyone else.
 *
 * @remarks
 * The mutation argument carries both `id` (what the API deletes by) and
 * `name` (what the query cache is keyed by, so the right entries can be
 * evicted afterwards) — the caller already has both from the Skill it's
 * looking at.
 * @example
 * deleteSkill.mutate({ id: skill.id, name: skill.name })
 */
export function useDeleteSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; name: string }) =>
      apiFetch(`/skills/${encodeURIComponent(id)}`, null, { method: "DELETE" }),
    onSuccess: (_data, { name }) => {
      queryClient.invalidateQueries({ queryKey: skillsListQueryKey });
      queryClient.removeQueries({ queryKey: skillQueryKey(name) });
    },
  });
}

/**
 * Downloads a Skill's Artifact and records the install.
 *
 * @remarks
 * Requests the `Accept: application/json` representation of
 * `GET /skills/{id}/artifact` rather than following its ordinary redirect —
 * that representation is the Skill itself, reflecting the install this same
 * request just recorded, alongside `url` to actually fetch the Artifact
 * from. Once that resolves (confirming the install was recorded), the
 * Skill's fresh state is written straight into the cache — the same
 * `setQueryData` `usePublishSkill` already uses — and only then does the
 * browser navigate to `url`, a plain top-level navigation rather than a
 * second `fetch`, so the actual transfer is never subject to storage's CORS
 * policy (see the route's own comment).
 * @example
 * downloadArtifact.mutate({ id: skill.id })
 */
export function useDownloadSkillArtifact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiFetch(`/skills/${encodeURIComponent(id)}/artifact`, SkillWithArtifactUrlSchema, {
        headers: { accept: "application/json" },
      }),
    onSuccess: ({ url, ...skill }) => {
      queryClient.setQueryData(skillQueryKey(skill.name), skill);
      window.location.href = url;
    },
  });
}
