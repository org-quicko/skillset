import { useEffect, useRef, useState } from "react";
import { SearchIcon, UploadIcon, XIcon } from "lucide-react";
import { SkillList } from "@/components/skill-list";
import { TagFilter } from "@/components/tag-filter";
import { Button } from "@/components/ui/button";
import { useSkillStats, type SkillDirectoryFilters } from "@/hooks/use-skills";
import { useTags } from "@/hooks/use-tags";

/**
 * How long typing has to pause before the search term reaches the URL.
 *
 * @remarks
 * The URL is the query key, so every value that lands there costs one request.
 * Without this the field issued one per keystroke and the reader watched a
 * table redraw under their fingers; the field itself stays immediate, because
 * only the push downstream is delayed.
 */
const SEARCH_DEBOUNCE_MS = 300;

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

/** One of the hero's stat cards — a count and its label, singular below 2. */
function HeroStat({ value, singular, plural }: { value: number; singular: string; plural: string }) {
  return (
    <div className="flex shrink-0 flex-col gap-1 rounded-lg border bg-card px-5 py-3.5">
      <span className="text-[22px] font-medium">{value.toLocaleString()}</span>
      <span className="text-xs tracking-[0.1em] text-muted-foreground uppercase">
        {value === 1 ? singular : plural}
      </span>
    </div>
  );
}

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
  const stats = useSkillStats().data;
  const searchRef = useRef<HTMLInputElement>(null);

  // What the field shows, which is not yet what the list is filtered by. The
  // URL still owns the applied term; this is only the keystrokes ahead of it.
  const [term, setTerm] = useState(filters.q);

  // Read through a ref so the timer below depends on the term alone. Closing
  // over `filters` instead would restart the debounce on every unrelated
  // re-render, which is the one thing a debounce must not do.
  const latest = useRef({ filters, onFiltersChange });
  latest.current = { filters, onFiltersChange };

  useEffect(() => {
    const timer = setTimeout(() => {
      const { filters: applied, onFiltersChange: apply } = latest.current;
      if (term !== applied.q) apply({ ...applied, q: term });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  // The applied term can change without a keystroke — the back button, or a
  // shared link. Re-running our own push is a no-op, since `term` already
  // equals it by then.
  useEffect(() => {
    setTerm(filters.q);
  }, [filters.q]);

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
            {stats && (
              <div className="flex shrink-0 flex-wrap gap-3">
                <HeroStat value={stats.skills} singular="Skill" plural="Skills" />
                <HeroStat value={stats.publishers} singular="Publisher" plural="Publishers" />
                <HeroStat value={stats.installs} singular="Install" plural="Installs" />
              </div>
            )}
          </div>

          <div className="flex h-[46px] items-center gap-2.5 rounded-lg border bg-background px-4 focus-within:border-ring dark:bg-muted">
            <SearchIcon className="size-[19px] shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search skills, tags or publishers"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {term && (
              <button
                type="button"
                aria-label="Clear search"
                // Applied immediately as well as cleared in the field:
                // clearing is a decision, not a keystroke, so it should not
                // sit behind the debounce.
                onClick={() => {
                  setTerm("");
                  onFiltersChange({ ...filters, q: "" });
                }}
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
