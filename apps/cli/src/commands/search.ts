import {
  resolveTagIdByName,
  SkillDirectoryPageSchema,
  TagListSchema,
  type SkillDirectoryEntry,
} from "@in-org-quicko/skillset-shared";
import { registryFetch } from "../http.js";
import { openReadClient, type SessionDeps } from "../session.js";

export interface SearchOptions {
  /** The term to match. Omitted, the whole catalog is listed. */
  query?: string;
  /** A Tag's name to narrow by — not its id, which nobody types. */
  tag?: string;
  /** `--limit`, as the flag arrives: a string, or absent. */
  limit?: string;
}

/** What `skillset search` found, and how much of the catalog that is. */
export interface SearchReport {
  items: SkillDirectoryEntry[];
  /** How many Skills matched in total, which may exceed `items.length`. */
  total: number;
  /** True when more matched than came back, so the caller can say so rather than implying it saw everything. */
  truncated: boolean;
}

/** Parses `--limit`, refusing rather than silently ignoring a value that is not a positive whole number. */
function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`--limit must be a positive whole number, not "${value}".`);
  }
  return limit;
}

/**
 * Searches the Registry's catalog, or lists all of it.
 *
 * @param deps - The fetch implementation, config-file path, and environment
 * to resolve the Registry from.
 * @param options - An optional term, an optional Tag name, and an optional
 * cap on results.
 * @returns The matching Skills, how many matched in total, and whether that
 * total exceeds what came back.
 * @throws Error when no Registry is configured, `--limit` is not a positive
 * whole number, or `--tag` names no Tag — the last of those listing the Tags
 * that do exist.
 * @throws ApiError when the Registry refuses the request.
 * @throws RegistryUnreachableError when the Registry cannot be reached.
 *
 * @remarks
 * The counterpart to `skillset list`, and the two are easy to confuse: this
 * one asks what the team has published, `list` asks what this project has
 * installed. Neither can answer the other's question.
 *
 * The term is optional, so this doubles as "show me everything" — there is
 * otherwise no way to see the catalog from a terminal, and requiring a term
 * meant guessing at one.
 *
 * `sort_by` is deliberately not sent, so the Registry's own default applies:
 * relevance when there is a term, recency when there is not (ADR-0039).
 *
 * Reads need no Token (ADR-0013), so this works against a Registry the User
 * has never logged in to.
 *
 * @example
 * ```ts
 * await runSearch(deps, { query: "code review" });
 * await runSearch(deps, {}); // the whole catalog
 * ```
 */
export async function runSearch(deps: SessionDeps, options: SearchOptions): Promise<SearchReport> {
  const limit = parseLimit(options.limit);
  const client = await openReadClient(deps);

  const params = new URLSearchParams({ kind: "skill" });
  const query = options.query?.trim();
  if (query) params.set("q", query);
  if (limit !== undefined) params.set("page_size", String(limit));
  if (options.tag) {
    const { items } = await registryFetch(client, "/tags", TagListSchema);
    params.set("tag_id", resolveTagIdByName(items, options.tag));
  }

  const page = await registryFetch(client, `/resources?${params.toString()}`, SkillDirectoryPageSchema);
  return { items: page.items, total: page.total, truncated: page.total > page.items.length };
}
