import { resolveTagIdByName, SkillDirectoryPageSchema, TagListSchema, type Tag } from "@in-org-quicko/skillset-shared";

/** What a caller of {@link searchSkills} may narrow a search by. */
export interface SearchSkillsParams {
  /** A task description or exact name. Omitted, every Skill is listed. */
  query?: string;
  /** A Tag's name, resolved to its id here — a caller has no way to know an id. */
  tag?: string;
  limit?: number;
  /** Opaque pagination token from a previous call's `next_cursor`. Omitted, the first page is returned. */
  cursor?: string;
}

/** One matching Skill, projected down to what an Agent needs to choose between them. */
export interface SearchSkillsResult {
  name: string;
  description: string;
  /** Tag names only; the ids they resolve from are the Registry's business. */
  tags: string[];
  /** Last republish, so a caller can see which of two similar Skills is being maintained. */
  updated_at: string;
  installs: number;
}

/** What {@link searchSkills} answers: the page of matches, and how much of the catalog it is. */
export interface SearchSkillsResponse {
  results: SearchSkillsResult[];
  /** How many Skills matched in total, which may exceed `results.length`. */
  total: number;
  /** True when there is a further page beyond this one — pass `next_cursor` back as `cursor` to fetch it. */
  truncated: boolean;
  page: number;
  page_size: number;
  /** `cursor` for the next call, or `null` once `page * page_size` has reached `total`. */
  next_cursor: string | null;
}

/**
 * Fetches the Registry's whole Tag catalog.
 *
 * @throws Error on a non-2xx response.
 *
 * @remarks
 * Exported for {@link "../resources.js".completeTagName} and
 * {@link "../resources.js".listTagResources}, which need the same catalog `resolveTagId`
 * resolves a name against — one fetch, shared, rather than each reimplementing it.
 */
export async function fetchTagCatalog(fetchImpl: typeof fetch, registryUrl: string): Promise<Tag[]> {
  const res = await fetchImpl(new URL("/api/tags", registryUrl));
  if (!res.ok) throw new Error(`Could not read the Tag catalog (status ${res.status}).`);
  return TagListSchema.parse(await res.json()).items;
}

/** Resolves a Tag's name to the id `GET /resources` filters on. @throws Error naming every known Tag if there is no match. */
async function resolveTagId(fetchImpl: typeof fetch, registryUrl: string, name: string): Promise<string> {
  return resolveTagIdByName(await fetchTagCatalog(fetchImpl, registryUrl), name);
}

/**
 * Searches — or, with no query, lists — the Registry's Skill catalog.
 *
 * @param fetchImpl - The `fetch` implementation to send the request with — injected so this
 * function is testable without a real network call or a running MCP client.
 * @param registryUrl - The Registry's base URL, as configured by `--registry`/`SKILLSET_REGISTRY`.
 * @param params - An optional `query`, an optional Tag `name` to filter by, an optional
 * cap on how many results come back per page, and an optional `cursor` to page past it.
 * @returns Each matching Skill's name, description, Tags, last update, and install count,
 * how many matched in total, and a `next_cursor` to fetch the page beyond this one.
 * @throws Error if the Registry answers with a non-2xx status, or if `tag` names no Tag.
 * @throws ZodError if a 2xx body does not match the expected page shape.
 *
 * @remarks
 * A thin projection of `GET /resources`, filtered to the `skill` Kind — the only Kind this
 * server serves. Sends no `authorization` header: the Registry's reads need none (ADR-0013),
 * and this server holds no credential to send.
 *
 * Two things here exist because the caller is an Agent rather than a browser. `query` is
 * optional, so "what Skills does this team have?" is answerable at all — there is no other
 * way for a caller to see the catalog, and requiring a term meant guessing at one. And
 * `tag` takes a Tag's *name*, resolved through `GET /tags` before the search, because an
 * Agent has no way to come by a Tag id: nothing it can call returns one.
 *
 * `cursor` is the Registry's own `page` number, round-tripped as an opaque string rather
 * than a field named `page` — without it, a catalog larger than one page (`limit`, or the
 * Registry's own default) was simply unreachable past the first `page_size` Skills. `null`
 * on `next_cursor` means there is nothing more to page to.
 *
 * `sort_by` is left unset so the Registry applies its own default — relevance when there
 * is a query, recency when there is not — which is the right order for both of the ways
 * this is called.
 *
 * @example
 * ```ts
 * await searchSkills(fetch, "https://registry.example", { query: "code review" });
 * await searchSkills(fetch, "https://registry.example", {}); // the whole catalog
 * const first = await searchSkills(fetch, "https://registry.example", { limit: 20 });
 * if (first.next_cursor) {
 *   await searchSkills(fetch, "https://registry.example", { limit: 20, cursor: first.next_cursor });
 * }
 * ```
 */
export async function searchSkills(
  fetchImpl: typeof fetch,
  registryUrl: string,
  params: SearchSkillsParams,
): Promise<SearchSkillsResponse> {
  const url = new URL("/api/resources", registryUrl);
  url.searchParams.set("kind", "skill");

  const query = params.query?.trim();
  if (query) url.searchParams.set("q", query);
  if (params.tag) url.searchParams.set("tag_id", await resolveTagId(fetchImpl, registryUrl, params.tag));
  if (params.limit !== undefined) url.searchParams.set("page_size", String(params.limit));
  if (params.cursor) url.searchParams.set("page", params.cursor);

  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`Search failed with status ${res.status}.`);
  }

  const page = SkillDirectoryPageSchema.parse(await res.json());
  const hasMore = page.page * page.page_size < page.total;
  return {
    page: page.page,
    page_size: page.page_size,
    truncated: hasMore,
    next_cursor: hasMore ? String(page.page + 1) : null,
    results: page.items.map((item) => ({
      name: item.name,
      description: item.description,
      tags: item.tags.map((tag) => tag.name),
      updated_at: item.updated_at,
      installs: item.installs,
    })),
    total: page.total,
  };
}
