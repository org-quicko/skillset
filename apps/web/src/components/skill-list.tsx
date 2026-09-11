import type { SkillDirectorySortField, SkillDirectorySortOrder } from "@in-org-quicko/skillset-shared";
import { ArrowDownIcon, ArrowUpIcon, SearchXIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSkillDirectory, type SkillDirectoryFilters } from "@/hooks/use-skills";
import { apiErrorMessage } from "@/lib/api";
import { skillPath } from "@/lib/routes";
import { cn, formatRelativeTime } from "@/lib/utils";

/** How many of a Skill's Tags show as their own chip before the rest collapse into a "+N" one. */
const VISIBLE_TAG_COUNT = 2;

const HEAD_CLASS = "text-xs font-normal tracking-[0.08em] text-muted-foreground";

/** One shimmering placeholder row matching the directory table's column layout. */
function SkillListSkeletonRow({ index }: { index: number }) {
  return (
    <TableRow key={index} className="hover:bg-transparent">
      <TableCell>
        <Skeleton className="h-3 w-4" />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-14 rounded-full" />
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Skeleton className="size-[26px] rounded-full" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className="h-3 w-12" />
      </TableCell>
      <TableCell>
        <Skeleton className="ml-auto h-3 w-10" />
      </TableCell>
    </TableRow>
  );
}

/** The placeholder table shown while the first page of the directory loads. */
function SkillListSkeleton() {
  return (
    <div className="w-full">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn("w-10", HEAD_CLASS)}>#</TableHead>
            <TableHead className={HEAD_CLASS}>Skill</TableHead>
            <TableHead className={cn("w-44", HEAD_CLASS)}>Publisher</TableHead>
            <TableHead className={cn("w-28", HEAD_CLASS)}>Updated</TableHead>
            <TableHead className={cn("w-24 text-right", HEAD_CLASS)}>Installs</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 8 }).map((_, index) => (
            <SkillListSkeletonRow key={index} index={index} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** A column header that toggles sort_by/sort_order on click, showing the current direction when this column is the active sort. The arrow always sits to the right of the label, whichever side the column's text aligns to. */
function SortHeader({
  field,
  label,
  filters,
  onFiltersChange,
}: {
  field: SkillDirectorySortField;
  label: string;
  filters: SkillDirectoryFilters;
  onFiltersChange: (filters: SkillDirectoryFilters) => void;
}) {
  const active = filters.sortBy === field;
  const desc = active && filters.sortOrder === "desc";
  const nextOrder: SkillDirectorySortOrder = active && filters.sortOrder === "desc" ? "asc" : "desc";

  return (
    <button
      type="button"
      onClick={() => onFiltersChange({ ...filters, sortBy: field, sortOrder: nextOrder })}
      className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-inherit outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {label}
      {desc ? (
        <ArrowDownIcon strokeWidth={1.5} className="size-3.5" />
      ) : (
        <ArrowUpIcon strokeWidth={1.5} className={cn("size-3.5", !active && "opacity-40")} />
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

  if (skills.isPending) return <SkillListSkeleton />;

  if (skills.isError) {
    return <p className="px-5 py-10 text-center text-sm text-destructive">{apiErrorMessage(skills.error)}</p>;
  }

  if (skills.isSuccess && rows.length === 0) {
    const hasFilters = filters.q.trim() !== "" || filters.tagIds.length > 0;
    return (
      <div className="fill-mode-both flex animate-in flex-col items-center gap-2 px-5 py-14 text-center fade-in-0 duration-300 motion-reduce:animate-none">
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
          <TableHead className="w-10 text-xs font-normal tracking-[0.08em] text-muted-foreground">#</TableHead>
          <TableHead className="text-xs font-normal tracking-[0.08em] text-muted-foreground">Skill</TableHead>
          <TableHead className="w-44 text-center text-xs font-normal tracking-[0.08em] text-muted-foreground">
            Publisher
          </TableHead>
          <TableHead className="w-28 text-center text-xs font-normal tracking-[0.08em] text-muted-foreground">
            <SortHeader field="updated_at" label="Updated" filters={filters} onFiltersChange={onFiltersChange} />
          </TableHead>
          <TableHead className="w-24 text-center text-xs font-normal tracking-[0.08em] text-muted-foreground">
            <SortHeader field="installs" label="Installs" filters={filters} onFiltersChange={onFiltersChange} />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((skill, index) => {
          const visibleTags = skill.tags.slice(0, VISIBLE_TAG_COUNT);
          const hiddenTags = skill.tags.slice(VISIBLE_TAG_COUNT);
          return (
            <TableRow
              key={skill.id}
              style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
              className="fill-mode-both animate-in cursor-pointer fade-in-0 slide-in-from-bottom-1 duration-300 [animation-timing-function:cubic-bezier(0.2,0,0,1)] motion-reduce:animate-none"
              onClick={() => onSelect(skill.name)}
            >
              <TableCell className="text-xs text-muted-foreground">{index + 1}</TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* A real link, so the row is reachable and openable by keyboard
                      and honours modifier-clicks; the row's own onClick stays for
                      pointer users clicking anywhere else in it. */}
                  <a
                    href={skillPath(skill.name)}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      event.stopPropagation();
                      onSelect(skill.name);
                    }}
                    className="rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {skill.name}
                  </a>
                  {visibleTags.map((tag) => (
                    <Badge key={tag.id} asChild variant="outline">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onFiltersChange({ ...filters, tagIds: [tag.id] });
                        }}
                        className="cursor-pointer hover:bg-muted hover:text-muted-foreground"
                      >
                        {tag.name}
                      </button>
                    </Badge>
                  ))}
                  {hiddenTags.length > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge asChild variant="secondary">
                          <button type="button" onClick={(event) => event.stopPropagation()}>
                            +{hiddenTags.length}
                          </button>
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>{hiddenTags.map((tag) => tag.name).join(", ")}</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex min-w-0 items-center justify-center gap-2">
                  <Avatar className="size-[26px] shrink-0">
                    <AvatarFallback className="text-[11px]">{initials(skill.published_by_name)}</AvatarFallback>
                  </Avatar>
                  <span className="truncate text-sm text-muted-foreground">{skill.published_by_name}</span>
                </div>
              </TableCell>
              <TableCell className="text-center text-xs text-muted-foreground">
                {formatRelativeTime(skill.updated_at)}
              </TableCell>
              <TableCell className="text-center tabular-nums">{skill.installs.toLocaleString()}</TableCell>
            </TableRow>
          );
        })}
        {isFetchingNextPage && <SkillListSkeletonRow index={rows.length} />}
      </TableBody>
    </Table>
      {hasNextPage && <div ref={sentinelRef} className="h-px" />}
    </div>
  );
}
