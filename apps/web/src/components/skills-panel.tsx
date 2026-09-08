import {
  isSkillDirectorySortField,
  isSkillDirectorySortOrder,
  roleMeets,
  type Role,
  type SkillDirectorySortField,
  type SkillDirectorySortOrder,
} from "@skillset/shared";
import { useState } from "react";
import { PublishSkillForm } from "@/components/publish-skill-form";
import { SkillDetail } from "@/components/skill-detail";
import { SkillsHome } from "@/components/skills-home";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SkillDirectoryFilters } from "@/hooks/use-skills";
import { LOGIN_PATH, SKILL_PATH_PREFIX, skillPath } from "@/lib/routes";
import { useRouter } from "@/lib/use-router";

const DEFAULT_SORT_BY: SkillDirectorySortField = "installs";
const DEFAULT_SORT_ORDER: SkillDirectorySortOrder = "desc";

/**
 * Reads the Skill list's filter/sort state from the URL's own query string
 * (ticket 23) rather than component state, so a specific search, Tag
 * selection, and sort choice is bookmarkable and shareable. An unrecognised
 * or absent `sort_by`/`sort_order` falls back to the default rather than
 * being treated as an error — this is a read of an already-shareable link,
 * not a form submission to validate.
 */
function filtersFromSearch(search: URLSearchParams): SkillDirectoryFilters {
  const sortBy = search.get("sort_by");
  const sortOrder = search.get("sort_order");
  return {
    q: search.get("q") ?? "",
    tagIds: search.getAll("tag_id"),
    sortBy: isSkillDirectorySortField(sortBy) ? sortBy : DEFAULT_SORT_BY,
    sortOrder: isSkillDirectorySortOrder(sortOrder) ? sortOrder : DEFAULT_SORT_ORDER,
  };
}

/** The inverse of `filtersFromSearch` — omits anything already at its default, so the ordinary unfiltered view's URL stays plain. */
function searchFromFilters(filters: SkillDirectoryFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  for (const tagId of filters.tagIds) params.append("tag_id", tagId);
  if (filters.sortBy !== DEFAULT_SORT_BY) params.set("sort_by", filters.sortBy);
  if (filters.sortOrder !== DEFAULT_SORT_ORDER) params.set("sort_order", filters.sortOrder);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

/** `role` is `null` for a signed-out visitor — they can browse and search, but no write action is offered. */
export function SkillsPanel({ role }: { role: Role | null }) {
  const { pathname, search, navigate, replace } = useRouter();
  const [publishOpen, setPublishOpen] = useState(false);

  const filters = filtersFromSearch(search);
  const isSignedOut = role === null;
  // Shown to every visitor, signed out or not: clicking it while signed out
  // asks for a login instead of hiding the option outright (reads never
  // require a session, but publishing does).
  const canPublish = role === null || roleMeets(role, "writer");

  // Replace, not navigate: every keystroke, Tag toggle, or sort click is a
  // refinement of the same view, not a transition the back button should
  // have to step back through one at a time.
  function handleFiltersChange(next: SkillDirectoryFilters) {
    replace(searchFromFilters(next));
  }

  if (pathname.startsWith(SKILL_PATH_PREFIX)) {
    const name = decodeURIComponent(pathname.slice(SKILL_PATH_PREFIX.length));
    return (
      <div className="mx-auto w-full max-w-[1200px] px-7 pt-6 pb-10">
        <SkillDetail
          name={name}
          canDelete={role !== null && roleMeets(role, "admin")}
          canEditTags={role !== null && roleMeets(role, "writer")}
          canRenameTags={role !== null && roleMeets(role, "admin")}
          onBack={() => navigate("/")}
          onDeleted={() => navigate("/")}
        />
      </div>
    );
  }

  return (
    <>
      <SkillsHome
        canPublish={canPublish}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onSelect={(name) => navigate(skillPath(name))}
        onPublish={() => (isSignedOut ? navigate(LOGIN_PATH) : setPublishOpen(true))}
      />
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Publish a Skill</DialogTitle>
            <DialogDescription>Drop the Skill&apos;s folder here, or choose it from a dialog.</DialogDescription>
          </DialogHeader>
          <PublishSkillForm
            onPublished={(name) => {
              setPublishOpen(false);
              navigate(skillPath(name));
            }}
            onCancel={() => setPublishOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
