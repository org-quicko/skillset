import { useEffect, useRef, useState } from "react";
import type { Role } from "@in-org-quicko/skillset-shared";
import { SearchIcon, XIcon } from "lucide-react";
import { CountUp } from "@/components/count-up";
import { Reveal } from "@/components/reveal";
import { SkillList } from "@/components/skill-list";
import { TagFilter } from "@/components/tag-filter";
import { Skeleton } from "@/components/ui/skeleton";
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
 * Whether the current device is a Mac, for choosing between the "Cmd" and
 * "Ctrl" shortcut hints.
 *
 * @remarks
 * `navigator.platform` is deprecated but still the most broadly supported
 * signal; `userAgentData.platform` is preferred where available. Defaults to
 * `false` (i.e. "Ctrl") when neither is present, such as during SSR.
 */
function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaDataPlatform = (navigator as { userAgentData?: { platform?: string } }).userAgentData
    ?.platform;
  return /mac/i.test(uaDataPlatform ?? navigator.platform ?? navigator.userAgent ?? "");
}

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

/** One section of the hero's stats container — a count that eases up from its previous value, and its label, singular below 2. */
function HeroStat({ value, singular, plural }: { value: number; singular: string; plural: string }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-3.5">
      <CountUp value={value} className="text-[22px] font-medium tabular-nums" />
      <span className="text-xs tracking-[0.1em] text-muted-foreground uppercase">
        {value === 1 ? singular : plural}
      </span>
    </div>
  );
}

/** Placeholder for a stats section while `useSkillStats` is in flight. */
function HeroStatSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-5 py-4">
      <Skeleton className="h-6 w-14" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

export function SkillsHome({
  filters,
  onFiltersChange,
  onSelect,
  role,
}: {
  filters: SkillDirectoryFilters;
  onFiltersChange: (filters: SkillDirectoryFilters) => void;
  onSelect: (name: string) => void;
  role: Role | null;
}) {
  const tags = useTags();
  const statsQuery = useSkillStats();
  const stats = statsQuery.data;
  const searchRef = useRef<HTMLInputElement>(null);
  // Computed once per mount — the platform doesn't change under the user.
  const [isMac] = useState(isMacPlatform);

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
              <Reveal delayMs={0} className="text-[32px] leading-none font-medium">
                <h1>Skills</h1>
              </Reveal>
              <Reveal
                delayMs={60}
                className="max-w-[460px] text-base leading-relaxed text-pretty text-muted-foreground"
              >
                <p>Browse and install skills for research, coding, design, automation, and more.</p>
              </Reveal>
            </div>
            <Reveal delayMs={120} className="shrink-0">
              {stats ? (
                <div className="grid grid-cols-3 divide-x rounded-lg border bg-card">
                  <HeroStat value={stats.skills} singular="Skill" plural="Skills" />
                  <HeroStat value={stats.publishers} singular="Publisher" plural="Publishers" />
                  <HeroStat value={stats.installs} singular="Install" plural="Installs" />
                </div>
              ) : statsQuery.isPending ? (
                <div className="grid grid-cols-3 divide-x rounded-lg border bg-card">
                  <HeroStatSkeleton />
                  <HeroStatSkeleton />
                  <HeroStatSkeleton />
                </div>
              ) : null}
            </Reveal>
          </div>

          <Reveal
            delayMs={180}
            className="flex h-[46px] items-center gap-2.5 rounded-lg border bg-background px-4 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-muted"
          >
            <SearchIcon strokeWidth={1.5} className="size-[19px] shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search skills"
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
                className="-my-2 -ml-2 flex shrink-0 cursor-pointer rounded-md p-2 text-muted-foreground transition-[color,scale] duration-150 ease-out outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.96]"
              >
                <XIcon className="size-4" />
              </button>
            )}
            <span className="hidden shrink-0 gap-1 sm:flex">
              <kbd className="rounded border bg-muted px-1.5 text-[11px] text-muted-foreground">
                {isMac ? "Cmd" : "Ctrl"}
              </kbd>
              <kbd className="rounded border bg-muted px-1.5 text-[11px] text-muted-foreground">K</kbd>
            </span>
          </Reveal>
        </div>
      </section>

      <div className="h-px bg-border" />

      <Reveal
        delayMs={220}
        className="mx-auto flex w-full max-w-[1200px] flex-col gap-3.5 px-7 pt-5 pb-10"
      >
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
          <SkillList filters={filters} onFiltersChange={onFiltersChange} onSelect={onSelect} role={role} />
        </div>
      </Reveal>
    </div>
  );
}
