import { SkillDirectoryPageSchema } from "@in-org-quicko/skillset-shared";

/** What a caller of {@link searchSkills} may narrow a search by. */
export interface SearchSkillsParams {
  query: string;
  tag?: string;
  limit?: number;
}

/** One matching Skill, projected down to what an Agent needs to judge relevance. */
export interface SearchSkillsResult {
  name: string;
  description: string;
}

/**
 * Searches the Registry's catalog for Skills matching a query.
 *
 * @param fetchImpl - The `fetch` implementation to send the request with — injected so this
 * function is testable without a real network call or a running MCP client.
 * @param registryUrl - The Registry's base URL, as configured by `--registry`/`SKILLSET_REGISTRY`.
 * @param params - The search's `query`, an optional Tag id to filter by, and an optional cap on
 * how many results come back.
 * @returns Each matching Skill's `name` and `description`, or an empty array when nothing matches.
 * @throws Error if the Registry answers with a non-2xx status.
 * @throws ZodError if a 2xx body does not match the expected page shape.
 *
 * @remarks
 * A thin projection of `GET /resources` (the same full-text search the web catalog uses),
 * filtered to the `skill` Kind — the only Kind this server serves (spec: no MCP Server or
 * Plugin obtainable through it). Sends no `authorization` header: the Registry's reads need
 * none (ADR-0013), and this server holds no credential to send.
 *
 * @example
 * ```ts
 * const results = await searchSkills(fetch, "https://registry.example", { query: "code review" });
 * ```
 */
export async function searchSkills(
  fetchImpl: typeof fetch,
  registryUrl: string,
  params: SearchSkillsParams,
): Promise<SearchSkillsResult[]> {
  const url = new URL("/api/resources", registryUrl);
  url.searchParams.set("q", params.query);
  url.searchParams.set("kind", "skill");
  if (params.tag) url.searchParams.set("tag_id", params.tag);
  if (params.limit !== undefined) url.searchParams.set("page_size", String(params.limit));

  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`Search failed with status ${res.status}.`);
  }

  const page = SkillDirectoryPageSchema.parse(await res.json());
  return page.items.map((item) => ({ name: item.name, description: item.description }));
}
