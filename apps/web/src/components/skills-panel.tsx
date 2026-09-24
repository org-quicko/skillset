import {
  defaultSkillDirectorySortField,
  isSkillDirectorySortField,
  isSkillDirectorySortOrder,
  resolveSkillDirectorySortField,
  roleMeets,
  type Role,
  type SkillDirectorySortOrder,
} from "@in-org-quicko/skillset-shared";
import { SkillDetail } from "@/components/skill-detail";
import { SkillsHome } from "@/components/skills-home";
import type { SkillDirectoryFilters } from "@/hooks/use-skills";
import { namespaceFromSearch, SKILL_PATH_PREFIX, skillPath } from "@/lib/routes";
import { useRouter } from "@/lib/use-router";

// `sort_by` has no single default — it is `relevance` while a search term is
// active and `updated_at` otherwise, which is the rule the API applies to the
// same query string (`resolveSkillDirectorySortField`). Only `sort_order` is a
// constant.
const DEFAULT_SORT_ORDER: SkillDirectorySortOrder = "desc";

/**
 * Reads the Skill list's filter/sort state from the URL's own query string
 * (ticket 23) rather than component state, so a specific search, Tag
 * selection, and sort choice is bookmarkable and shareable. An unrecognised
 * or absent `sort_by`/`sort_order` falls back to the default rather than
 * being treated as an error — this is a read of an already-shareable link,
 * not a form submission to validate.
 *
 * `sort_by`'s fallback depends on `q`, so it is resolved through the same
 * shared rule the API uses rather than a constant: a link carrying a search
 * term and no explicit sort must rank, exactly as the API would have ranked
 * it had the parameter been left off the request too.
 */
function filtersFromSearch(search: URLSearchParams): SkillDirectoryFilters {
  const sortBy = search.get("sort_by");
  const sortOrder = search.get("sort_order");
  const q = search.get("q") ?? "";
  return {
    q,
    tagIds: search.getAll("tag_id"),
    sortBy: resolveSkillDirectorySortField(isSkillDirectorySortField(sortBy) ? sortBy : undefined, q),
    sortOrder: isSkillDirectorySortOrder(sortOrder) ? sortOrder : DEFAULT_SORT_ORDER,
  };
}

/** The inverse of `filtersFromSearch` — omits anything already at its default, so the ordinary unfiltered view's URL stays plain. */
function searchFromFilters(filters: SkillDirectoryFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  for (const tagId of filters.tagIds) params.append("tag_id", tagId);
  // Omitted while it matches what this term would default to anyway, so
  // searching keeps a plain `?q=…` link and only a deliberate column click
  // pins a sort into the URL.
  if (filters.sortBy !== defaultSkillDirectorySortField(filters.q)) params.set("sort_by", filters.sortBy);
  if (filters.sortOrder !== DEFAULT_SORT_ORDER) params.set("sort_order", filters.sortOrder);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

/** `role` is `null` for a signed-out visitor — they can browse and search, but no write action is offered. */
export function SkillsPanel({ role }: { role: Role | null }) {
  const { pathname, search, navigate, replace } = useRouter();

  const filters = filtersFromSearch(search);

  // Replace, not navigate: every keystroke, Tag toggle, or sort click is a
  // refinement of the same view, not a transition the back button should
  // have to step back through one at a time.
  function handleFiltersChange(next: SkillDirectoryFilters) {
    replace(searchFromFilters(next));
  }

  if (pathname.startsWith(SKILL_PATH_PREFIX)) {
    const name = decodeURIComponent(pathname.slice(SKILL_PATH_PREFIX.length));
    return (
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1200px] flex-col px-7 pt-6 pb-10">
        <SkillDetail
          name={name}
          // Undefined for a bare `/skills/<name>`, which the Registry resolves
          // rather than refusing (ADR-0042).
          namespace={namespaceFromSearch(search)}
          canDelete={role !== null && roleMeets(role, "admin")}
          canEditTags={role !== null && roleMeets(role, "writer")}
          onBack={() => navigate("/")}
          onDeleted={() => navigate("/")}
        />
      </div>
    );
  }

  return (
    <SkillsHome
      filters={filters}
      onFiltersChange={handleFiltersChange}
      onSelect={(name, namespace) => navigate(skillPath(name, namespace))}
      role={role}
    />
  );
}
