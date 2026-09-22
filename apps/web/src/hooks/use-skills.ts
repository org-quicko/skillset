import {
  artifactMediaType,
  ArtifactManifestSchema,
  buildSkillBundle,
  SkillDirectoryPageSchema,
  SkillDirectoryStatsSchema,
  SkillInstallTrendSchema,
  SkillPublishedSchema,
  SkillSchema,
  type Skill,
  type SkillDirectorySortField,
  type SkillDirectorySortOrder,
  type SkillFile,
} from "@in-org-quicko/skillset-shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiFetchText, apiUrl } from "@/lib/api";
import {
  resourceArtifactFileQueryKey,
  resourceArtifactFilesQueryKey,
  resourceDirectoryQueryKey,
  resourceInstallTrendQueryKey,
  resourceQueryKey,
  resourcesListQueryKey,
  resourceStatsQueryKey,
} from "@/lib/query-keys";

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
 * Every filter rides the query key (`resourceDirectoryQueryKey`), so changing
 * the search term, Tag filter, or sort choice starts a fresh accumulation of
 * pages from page 1 rather than appending to, or reusing, a previous
 * combination's pages — matching the requirement that changing any of them
 * resets the list. `page_size` is left to the API's own default; nothing
 * here exposes a control for it (out of scope, ticket 23).
 *
 * No `?kind=` is sent: `skill` is the only registered Kind (ADR-0026), so an
 * unfiltered `GET /resources` already lists exactly what this page shows.
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
    queryKey: resourceDirectoryQueryKey(filters),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        page: String(pageParam),
        sort_by: filters.sortBy,
        sort_order: filters.sortOrder,
      });
      if (filters.q) params.set("q", filters.q);
      for (const tagId of filters.tagIds) params.append("tag_id", tagId);
      return apiFetch(`/resources?${params.toString()}`, SkillDirectoryPageSchema);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.page * lastPage.page_size;
      return loaded < lastPage.total ? lastPage.page + 1 : undefined;
    },
  });
}

/**
 * Fetches the catalog's hero stats: the total Resource count, the distinct
 * Publisher count, and the total Install count across every Resource.
 *
 * @remarks
 * Unfiltered — the same regardless of any search term or Tag selection in
 * `useSkillDirectory`, unlike its own `total`. What the home page's stat
 * cards read.
 *
 * @returns The TanStack Query result for `GET /resources/stats`.
 * @example
 * const stats = useSkillStats();
 */
export function useSkillStats() {
  return useQuery({
    queryKey: resourceStatsQueryKey,
    queryFn: () => apiFetch("/resources/stats", SkillDirectoryStatsSchema),
  });
}

/**
 * Fetches a single Skill by name — the browser URL is always `/skills/<name>`
 * (ADR-0002's flat identity is still what a person types or bookmarks), and
 * `GET /resources/skill/by-name/<name>` returns the same full Skill shape
 * reading by `id` would (ticket 16), so there's no separate id lookup to do
 * first: an indexed lookup on the unique `(kind, name)` pair is exactly as
 * cheap as one on the `id` primary key. `id` itself is only needed once the
 * Skill is already in hand, for the Delete and Download actions (`skill.id`
 * off this query's result) — see `useDeleteSkill` and
 * `useDownloadSkillArtifact`.
 *
 * @param name - The Skill's name, from the `/skills/<name>` URL.
 * @returns The TanStack Query result for that Skill.
 * @throws ApiError with code `"not_found"` if no Skill exists by that name.
 */
export function useSkill(name: string) {
  return useQuery({
    queryKey: resourceQueryKey(name),
    queryFn: () => apiFetch(`/resources/skill/by-name/${encodeURIComponent(name)}`, SkillSchema),
    // A publish already writes this exact response into the cache
    // (usePublishSkill's onSuccess) — avoid an immediate, redundant refetch
    // of what was just returned when the reader lands straight on it.
    staleTime: 30_000,
  });
}

/**
 * Fetches a Skill's install trend: one point per day for a fixed trailing
 * window, oldest first, zero-filled for days with no recorded Install — the
 * Installs panel's chart.
 *
 * @param id - The Skill's id (`skill.id`, from `useSkill`) — the endpoint is
 * id-keyed, unlike `useSkill` itself. Pass `undefined` while the owning
 * Skill is still loading; the query stays disabled until it settles.
 * @returns The TanStack Query result for `GET /resources/{id}/installs/trend`.
 * @example
 * const trend = useSkillInstallTrend(skill.data?.id);
 */
export function useSkillInstallTrend(id: string | undefined) {
  return useQuery({
    queryKey: resourceInstallTrendQueryKey(id ?? ""),
    queryFn: () => apiFetch(`/resources/${encodeURIComponent(id ?? "")}/installs/trend`, SkillInstallTrendSchema),
    enabled: Boolean(id),
  });
}

/**
 * A failed upload's only recovery is retrying the publish — it replaces rather
 * than duplicates.
 *
 * @remarks
 * An Artifact is uploaded a file at a time (ADR-0032), so a partial failure
 * leaves the Skill's row published and its Artifact incomplete. That is the
 * same state as a publish interrupted before its single upload finished, and
 * it has the same fix: publish again. `path` names the file that failed, so
 * the message can say which one rather than only that one did.
 */
/**
 * What publishing takes: the files, and where they came from.
 *
 * `source` is the caller's to supply because only the caller knows — an Import
 * has a repository URL, and files dropped onto the page have nothing to say.
 * Omitted, the Registry records itself (ADR-0041).
 */
export interface PublishSkillInput {
  files: SkillFile[];
  source?: string;
}

export class SkillUploadError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`Uploading "${path}" failed. Retrying the publish will replace it, not duplicate it.`);
    this.name = "SkillUploadError";
    this.path = path;
  }
}

/**
 * Validates the files locally (`buildSkillBundle`, the same pipeline the CLI
 * and the API's own checks use), publishes the metadata and the Artifact's
 * manifest, then uploads each file straight to storage (ADR-0001, ADR-0032).
 * The Skill list is only invalidated once every upload has finished — never
 * while one is in flight.
 */
export function usePublishSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ files, source }: PublishSkillInput): Promise<Skill> => {
      const bundle = buildSkillBundle(files, { source });

      const published = await apiFetch(`/resources/skill/${encodeURIComponent(bundle.name)}`, SkillPublishedSchema, {
        method: "PUT",
        body: JSON.stringify(bundle.request),
      });

      // One presigned destination per declared file, in the order the manifest
      // declared them (ADR-0032), so the two lists line up index for index.
      await Promise.all(
        published.upload.files.map(async (target, index) => {
          const file = bundle.files[index];
          if (!file || file.path !== target.path) throw new SkillUploadError(target.path);

          const upload = await fetch(target.url, {
            method: target.method,
            headers: target.headers,
            // A `Uint8Array` read off a file is typed as backed by
            // `ArrayBufferLike`, which `BlobPart` doesn't accept directly —
            // re-wrapping narrows it to a concrete `ArrayBuffer`-backed view.
            body: new Blob([new Uint8Array(file.bytes)]),
          });
          if (!upload.ok) throw new SkillUploadError(target.path);
        }),
      );

      return published.skill;
    },
    onSuccess: (skill) => {
      queryClient.invalidateQueries({ queryKey: resourcesListQueryKey });
      queryClient.invalidateQueries({ queryKey: resourceStatsQueryKey });
      queryClient.setQueryData(resourceQueryKey(skill.name), skill);
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
      apiFetch(`/resources/${encodeURIComponent(id)}`, null, { method: "DELETE" }),
    onSuccess: (_data, { name }) => {
      queryClient.invalidateQueries({ queryKey: resourcesListQueryKey });
      queryClient.invalidateQueries({ queryKey: resourceStatsQueryKey });
      queryClient.removeQueries({ queryKey: resourceQueryKey(name) });
    },
  });
}

/**
 * Every file a Skill's Artifact holds — what the detail page's file browser
 * lists.
 *
 * @remarks
 * Read from storage rather than from anything the publisher declared, so a
 * Skill whose upload never finished reports what is actually there
 * (ADR-0032). A 404 is the ordinary answer for a Skill with no Artifact yet,
 * not an exception worth retrying — hence `retry: false`.
 *
 * `id` may be undefined while the Skill itself is still loading; the query
 * simply stays disabled until it is not.
 *
 * @param id - The Skill's id, or `undefined` while it is unknown.
 * @returns The TanStack Query result; `data.files` is one entry per file.
 * @example
 * const files = useArtifactFiles(skill.data?.id);
 */
export function useArtifactFiles(id: string | undefined) {
  return useQuery({
    queryKey: resourceArtifactFilesQueryKey(id ?? ""),
    queryFn: () => apiFetch(`/resources/${encodeURIComponent(id ?? "")}/files`, ArtifactManifestSchema),
    enabled: id !== undefined,
    retry: false,
  });
}

/**
 * The path of one file within an Artifact, encoded for a URL.
 *
 * Each segment is encoded on its own so the slashes between them survive —
 * the route matches the whole remainder as one parameter (`:path{.+}`), and a
 * wholly-encoded path would arrive as a single segment with `%2F` in it.
 */
function encodeArtifactPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** The browser-facing URL of one file of an Artifact — for an `<img src>` or an `<iframe>`. */
export function artifactFileUrl(id: string, path: string): string {
  return apiUrl(`/resources/${encodeURIComponent(id)}/files/${encodeArtifactPath(path)}`);
}

/**
 * The text of one file of an Artifact, for the preview's editor.
 *
 * @remarks
 * Only fetched for a file `artifactMediaType` calls text — an image or a PDF
 * is shown from its URL instead (`artifactFileUrl`), and there is nothing to
 * read for a binary. Cached per path, so clicking back and forth between two
 * files reads each one once.
 *
 * @param id - The Skill's id, or `undefined` while it is unknown.
 * @param path - The file's path within the Artifact, or `undefined` when none
 * is selected.
 * @returns The TanStack Query result; `data` is the file's text.
 * @example
 * const source = useArtifactFile(skill.id, "references/java.md");
 */
export function useArtifactFile(id: string | undefined, path: string | undefined) {
  const isText = path !== undefined && artifactMediaType(path).kind === "text";

  return useQuery({
    queryKey: resourceArtifactFileQueryKey(id ?? "", path ?? ""),
    queryFn: () => apiFetchText(`/resources/${encodeURIComponent(id ?? "")}/files/${encodeArtifactPath(path ?? "")}`),
    enabled: id !== undefined && isText,
    retry: false,
    // A file only changes when the Skill is republished, which invalidates
    // this key anyway — so nothing is gained by refetching one on remount.
    staleTime: Infinity,
  });
}

/**
 * Downloads a Skill's Artifact as a zip and records the Install.
 *
 * @remarks
 * A plain top-level navigation to `GET /resources/{id}/artifact`, which
 * assembles the zip from the Artifact's stored files and serves it as an
 * attachment (ADR-0032). There is no `fetch` and no presigned URL to
 * negotiate any more — the response never leaves this origin.
 *
 * Which means the request itself is no longer something this app can await,
 * so the Install it records is picked up by invalidating the Skill rather
 * than being read back from the response. That count carries
 * `refreshInstallCounts` lag regardless (ADR-0012), so there was never a
 * moment where it was guaranteed fresh.
 *
 * @param id - The Skill's id.
 * @param name - The Skill's name, which the detail query is keyed by.
 * @example
 * downloadArtifact(skill.id, skill.name)
 */
export function useDownloadSkillArtifact() {
  const queryClient = useQueryClient();

  return (id: string, name: string) => {
    window.location.href = apiUrl(`/resources/${encodeURIComponent(id)}/artifact`);
    queryClient.invalidateQueries({ queryKey: resourceQueryKey(name) });
    queryClient.invalidateQueries({ queryKey: resourceInstallTrendQueryKey(id) });
  };
}
