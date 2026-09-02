import type { SkillDirectorySortField, SkillDirectorySortOrder } from "@skill-registry/shared";
import { ArrowDownIcon, ArrowUpIcon, ArrowUpDownIcon, SearchXIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSkillDirectory, type SkillDirectoryFilters } from "@/hooks/use-skills";
import { apiErrorMessage } from "@/lib/api";
import { cn, formatRelativeTime } from "@/lib/utils";

/** How many of a Skill's Tags show as their own chip before the rest collapse into a "+N" one. */
const VISIBLE_TAG_COUNT = 2;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** A column header that toggles sort_by/sort_order on click, showing the current direction when this column is the active sort. */
function SortHeader({
  field,
  label,
  align,
  filters,
  onFiltersChange,
}: {
  field: SkillDirectorySortField;
  label: string;
  align: "start" | "end";
  filters: SkillDirectoryFilters;
  onFiltersChange: (filters: SkillDirectoryFilters) => void;
}) {
  const active = filters.sortBy === field;
  const nextOrder: SkillDirectorySortOrder = active && filters.sortOrder === "desc" ? "asc" : "desc";

  return (
    <button
      type="button"
      onClick={() => onFiltersChange({ ...filters, sortBy: field, sortOrder: nextOrder })}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1 text-inherit outline-none select-none hover:text-foreground focus-visible:text-foreground",
        align === "end" && "flex-row-reverse",
      )}
    >
      {label}
      {active ? (
        filters.sortOrder === "desc" ? (
          <ArrowDownIcon className="size-3.5" />
        ) : (
          <ArrowUpIcon className="size-3.5" />
        )
      ) : (
        <ArrowUpDownIcon className="size-3.5 opacity-40" />
      )}
    </button>
  );
}

/**
 * The Skill directory as a sortable, scroll-loaded table. Filter and sort
 * state is owned by the caller (the URL query string, via `SkillsHome`); this
 * component only renders it and reports changes back.
 *
 * @param filters - The active search term, Tag ids, and sort choice.
 * @param onFiltersChange - Called with the full new filter set when a sort header or Tag chip is clicked.
 * @param onSelect - Called with a Skill's name when its row is clicked.
 */
export function SkillList({
  filters,
  onFiltersChange,
  onSelect,
}: {
  filters: SkillDirectoryFilters;
  onFiltersChange: (filters: SkillDirectoryFilters) => void;
  onSelect: (name: string) => void;
}) {
  const skills = useSkillDirectory(filters);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const rows = skills.data?.pages.flatMap((page) => page.items) ?? [];
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = skills;

  // Scroll-loading: fetch the next page once the sentinel row scrolls into
  // view, rather than a Previous/Next control (ticket 23).
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingNextPage) fetchNextPage();
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (skills.isError) {
    return <p className="px-5 py-10 text-center text-sm text-destructive">{apiErrorMessage(skills.error)}</p>;
  }

  if (skills.isSuccess && rows.length === 0) {
    const hasFilters = filters.q.trim() !== "" || filters.tagIds.length > 0;
    return (
      <div className="flex flex-col items-center gap-2 px-5 py-14 text-center">
        <SearchXIcon className="size-6 text-ring" />
        <p className="text-sm text-muted-foreground">
          {hasFilters ? `No skills match “${filters.q || "that filter"}”` : "No skills published yet"}
        </p>
        {hasFilters && <p className="text-sm text-muted-foreground">Try a skill name, tag or publisher.</p>}
      </div>
    );
  }

  return (
    <div className="w-full">
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-10 text-xs font-normal tracking-[0.08em] text-muted-foreground uppercase">#</TableHead>
          <TableHead className="text-xs font-normal tracking-[0.08em] text-muted-foreground uppercase">Skill</TableHead>
          <TableHead className="w-44 text-xs font-normal tracking-[0.08em] text-muted-foreground uppercase">
            Publisher
          </TableHead>
          <TableHead className="w-28 text-xs font-normal tracking-[0.08em] text-muted-foreground uppercase">
            <SortHeader
              field="updated_at"
              label="Updated"
              align="start"
              filters={filters}
              onFiltersChange={onFiltersChange}
            />
          </TableHead>
          <TableHead className="w-24 text-right text-xs font-normal tracking-[0.08em] text-muted-foreground uppercase">
            <SortHeader
              field="installs"
              label="Installs"
              align="end"
              filters={filters}
              onFiltersChange={onFiltersChange}
            />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((skill, index) => {
          const visibleTags = skill.tags.slice(0, VISIBLE_TAG_COUNT);
          const hiddenTags = skill.tags.slice(VISIBLE_TAG_COUNT);
          return (
            <TableRow key={skill.id} className="cursor-pointer" onClick={() => onSelect(skill.name)}>
              <TableCell className="text-xs text-muted-foreground">{index + 1}</TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{skill.name}</span>
                  {visibleTags.map((tag) => (
                    <Badge
                      key={tag.id}
                      variant="outline"
                      className="cursor-pointer"
                      onClick={(event) => {
                        event.stopPropagation();
                        onFiltersChange({ ...filters, tagIds: [tag.id] });
                      }}
                    >
                      {tag.name}
                    </Badge>
                  ))}
                  {hiddenTags.length > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="secondary" onClick={(event) => event.stopPropagation()}>
                          +{hiddenTags.length}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>{hiddenTags.map((tag) => tag.name).join(", ")}</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Avatar className="size-[26px]">
                    <AvatarFallback className="text-[11px]">{initials(skill.published_by_name)}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm text-muted-foreground">{skill.published_by_name}</span>
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{formatRelativeTime(skill.updated_at)}</TableCell>
              <TableCell className="text-right tabular-nums">{skill.installs.toLocaleString()}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
      {hasNextPage && (
        <div ref={sentinelRef} className="py-3 text-center text-sm text-muted-foreground">
          {isFetchingNextPage ? "Loading more…" : ""}
        </div>
      )}
    </div>
  );
}
