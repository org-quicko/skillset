import { isSectionKind, SECTIONS } from "@/lib/sections";

/** Where a signed-out visitor lands, and the only path that renders `LoginForm`. */
export const LOGIN_PATH = "/login";

/** The URL path prefix every Skill detail page sits under. */
export const SKILL_PATH_PREFIX = SECTIONS.skill.detailPrefix;

/**
 * The URL path for a Skill's detail page.
 *
 * @param name - The Skill's name, percent-encoded into the path.
 * @param namespace - Which party named it, when the caller knows and the name
 * alone might not reach it (ADR-0042). Added as a query parameter rather than
 * more path segments, because a Namespace may itself contain a slash and is
 * compared whole — the same reason the API takes it that way.
 * @param kind - The Resource's Kind, which picks the section the page sits
 * under. A Kind with no section falls back to `/skills/`, which still resolves
 * it, since the detail read is Kind-agnostic.
 * @returns A root-relative path like `/skills/my-skill`,
 * `/skills/pdf?namespace=anthropics%2Fskills`, or `/mcp-servers/io.github.x%2Fy`.
 *
 * @remarks
 * A bare path still works and still means what it always did: the Registry
 * resolves an unqualified name to the only Skill of that name, or to the one
 * published here. Carrying the Namespace is what makes a row in a list that
 * *is* ambiguous linkable at all, and it keeps a shared or bookmarked URL
 * pointing at the Skill the reader was actually looking at.
 */
export function skillPath(name: string, namespace?: string, kind = "skill"): string {
  const prefix = isSectionKind(kind) ? SECTIONS[kind].detailPrefix : SKILL_PATH_PREFIX;
  const path = `${prefix}${encodeURIComponent(name)}`;
  return namespace ? `${path}?namespace=${encodeURIComponent(namespace)}` : path;
}

/**
 * Reads the Namespace out of a Skill page's query string.
 *
 * @param search - The URL's parsed query string.
 * @returns The Namespace, or undefined when the URL names none — which the
 * Registry resolves rather than refusing.
 */
export function namespaceFromSearch(search: URLSearchParams): string | undefined {
  return search.get("namespace") ?? undefined;
}
