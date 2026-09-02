import { useEffect, useRef } from "react";
import { SearchIcon, UploadIcon, XIcon } from "lucide-react";
import { SkillList } from "@/components/skill-list";
import { TagFilter } from "@/components/tag-filter";
import { Button } from "@/components/ui/button";
import { useSkillDirectory, type SkillDirectoryFilters } from "@/hooks/use-skills";
import { useTags } from "@/hooks/use-tags";

/** Filters with nothing selected — what the hero's Skill count is always taken against, so it doesn't move as the reader searches. */
const UNFILTERED: SkillDirectoryFilters = { q: "", tagIds: [], sortBy: "installs", sortOrder: "desc" };

/**
 * The masked dot grid behind the hero (1px dots, 20px grid, fading in
 * left-to-right). Dot colour is a per-theme token (`--hero-dot`) so it stays
 * faint on the light band and doesn't turn into hard black specks.
 */
const DOT_GRID_STYLE: React.CSSProperties = {
  backgroundImage: "radial-gradient(circle at center, var(--hero-dot) 0 1px, transparent 1.4px)",
  backgroundSize: "20px 20px",
  WebkitMaskImage: "linear-gradient(to right, transparent 20%, #000 100%)",
  maskImage: "linear-gradient(to right, transparent 20%, #000 100%)",
};

export function SkillsHome({
  filters,
  onFiltersChange,
  onSelect,
  canPublish,
  onPublish,
}: {
  filters: SkillDirectoryFilters;
  onFiltersChange: (filters: SkillDirectoryFilters) => void;
  onSelect: (name: string) => void;
  canPublish: boolean;
  onPublish: () => void;
}) {
  const tags = useTags();
  const total = useSkillDirectory(UNFILTERED).data?.pages[0]?.total;
  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K focuses the search box — the hint in the field, made real.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const hasTagFilters = filters.tagIds.length > 0;

  return (
    <div className="flex w-full flex-col">
      <section className="relative overflow-hidden bg-hero">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={DOT_GRID_STYLE} />
        <div className="relative mx-auto flex w-full max-w-[1200px] flex-col gap-7 px-7 pt-11 pb-8">
          <div className="flex flex-col items-start justify-between gap-8 sm:flex-row">
            <div className="flex flex-col gap-4">
              <h1 className="font-wordmark text-4xl leading-none tracking-[0.04em] sm:text-[60px]">SKILLSET</h1>
              <p className="max-w-[460px] text-base leading-relaxed text-muted-foreground">
                Browse and install skills for research, coding, design, automation, and more.
              </p>
              {canPublish && (
                <Button className="w-fit rounded-full" onClick={onPublish}>
                  <UploadIcon />
                  Publish a skill
                </Button>
              )}
            </div>
            {total !== undefined && (
              <div className="flex shrink-0 flex-col gap-1 rounded-lg border bg-card px-5 py-3.5">
                <span className="text-[22px] font-medium">{total.toLocaleString()}</span>
                <span className="text-xs tracking-[0.1em] text-muted-foreground uppercase">
                  {total === 1 ? "Skill" : "Skills"}
                </span>
              </div>
            )}
          </div>

          <div className="flex h-[46px] items-center gap-2.5 rounded-lg border bg-background px-4 focus-within:border-ring dark:bg-muted">
            <SearchIcon className="size-[19px] shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              value={filters.q}
              onChange={(event) => onFiltersChange({ ...filters, q: event.target.value })}
              placeholder="Search skills, tags or publishers"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {filters.q && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => onFiltersChange({ ...filters, q: "" })}
                className="flex shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-4" />
              </button>
            )}
            <span className="hidden shrink-0 gap-1 sm:flex">
              <kbd className="rounded border bg-muted px-1.5 text-[11px] text-muted-foreground">⌘</kbd>
              <kbd className="rounded border bg-muted px-1.5 text-[11px] text-muted-foreground">K</kbd>
            </span>
          </div>
        </div>
      </section>

      <div className="h-px bg-border" />

      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3.5 px-7 pt-5 pb-10">
        <div className="flex items-center gap-3">
          <TagFilter
            tags={tags.data?.items ?? []}
            selected={filters.tagIds}
            onChange={(tagIds) => onFiltersChange({ ...filters, tagIds })}
          />
          {hasTagFilters && (
            <button
              type="button"
              onClick={() => onFiltersChange({ ...filters, tagIds: [] })}
              className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border">
          <SkillList filters={filters} onFiltersChange={onFiltersChange} onSelect={onSelect} />
        </div>
      </div>
    </div>
  );
}
