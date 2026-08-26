import type { SkillDirectorySortField, SkillDirectorySortOrder } from "@skill-registry/shared";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, ArrowUpDownIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TagFilter } from "@/components/tag-filter";
import { useSkillDirectory, type SkillDirectoryFilters } from "@/hooks/use-skills";
import { useTags } from "@/hooks/use-tags";
import { apiErrorMessage } from "@/lib/api";
import { formatMoment } from "@/lib/utils";

interface DirectoryRow {
  id: string;
  name: string;
  published_by_name: string;
  updated_at: string;
  installs: number;
  tags: { id: string; name: string }[];
}

/** How many of a Skill's Tags show as their own chip before the rest collapse into a "+N" one. */
const VISIBLE_TAG_COUNT = 2;

/** The Name column's cell: the Skill's name plus up to two Tag chips, with any remainder behind a "+N" chip whose tooltip lists them by name. */
function NameCell({ name, tags }: { name: string; tags: { id: string; name: string }[] }) {
  const visible = tags.slice(0, VISIBLE_TAG_COUNT);
  const remaining = tags.slice(VISIBLE_TAG_COUNT);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-medium">{name}</span>
      {visible.map((tag) => (
        <Badge key={tag.id} variant="outline">
          {tag.name}
        </Badge>
      ))}
      {remaining.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary">+{remaining.length}</Badge>
          </TooltipTrigger>
          <TooltipContent>{remaining.map((tag) => tag.name).join(", ")}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/** A column header that toggles sort_by/sort_order on click, showing the current direction when this column is the active sort. */
function SortableHeader({
  field,
  label,
  sortBy,
  sortOrder,
  onSortChange,
}: {
  field: SkillDirectorySortField;
  label: string;
  sortBy: SkillDirectorySortField;
  sortOrder: SkillDirectorySortOrder;
  onSortChange: (sortBy: SkillDirectorySortField, sortOrder: SkillDirectorySortOrder) => void;
}) {
  const active = sortBy === field;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8"
      onClick={() => onSortChange(field, active && sortOrder === "desc" ? "asc" : "desc")}
    >
      {label}
      {active ? (
        sortOrder === "desc" ? (
          <ArrowDownIcon />
        ) : (
          <ArrowUpIcon />
        )
      ) : (
        <ArrowUpDownIcon className="opacity-50" />
      )}
    </Button>
  );
}

export function SkillList({
  canPublish,
  filters,
  onFiltersChange,
  onSelect,
  onPublish,
}: {
  canPublish: boolean;
  filters: SkillDirectoryFilters;
  onFiltersChange: (filters: SkillDirectoryFilters) => void;
  onSelect: (name: string) => void;
  onPublish: () => void;
}) {
  const skills = useSkillDirectory(filters);
  const tags = useTags();
  const sentinelRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => skills.data?.pages.flatMap((page) => page.items) ?? [], [skills.data]);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = skills;

  // Scroll-loading: fetch the next page once the sentinel below the table
  // scrolls into view, rather than a Previous/Next control (ticket 23).
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingNextPage) fetchNextPage();
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleSortChange = useCallback(
    (sortBy: SkillDirectorySortField, sortOrder: SkillDirectorySortOrder) => {
      onFiltersChange({ ...filters, sortBy, sortOrder });
    },
    [filters, onFiltersChange],
  );

  const columns = useMemo<ColumnDef<DirectoryRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => <NameCell name={row.original.name} tags={row.original.tags} />,
      },
      { accessorKey: "published_by_name", header: "Publisher" },
      {
        accessorKey: "updated_at",
        header: () => (
          <SortableHeader
            field="updated_at"
            label="Updated"
            sortBy={filters.sortBy}
            sortOrder={filters.sortOrder}
            onSortChange={handleSortChange}
          />
        ),
        cell: ({ row }) => formatMoment(row.original.updated_at),
      },
      {
        accessorKey: "installs",
        header: () => (
          <SortableHeader
            field="installs"
            label="Installs"
            sortBy={filters.sortBy}
            sortOrder={filters.sortOrder}
            onSortChange={handleSortChange}
          />
        ),
      },
    ],
    [filters.sortBy, filters.sortOrder, handleSortChange],
  );

  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <Card className="w-full max-w-5xl">
      <CardHeader>
        <CardTitle>Skills</CardTitle>
        {canPublish && (
          <CardAction>
            <Button onClick={onPublish}>Publish a Skill</Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Search by name, description, or publisher..."
            value={filters.q}
            onChange={(event) => onFiltersChange({ ...filters, q: event.target.value })}
            className="sm:max-w-sm"
          />
          <TagFilter
            tags={tags.data?.items ?? []}
            selected={filters.tagIds}
            onChange={(tagIds) => onFiltersChange({ ...filters, tagIds })}
          />
        </div>

        {skills.isError && <p className="text-sm text-destructive">{apiErrorMessage(skills.error)}</p>}
        {skills.isSuccess && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {filters.q || filters.tagIds.length > 0 ? "No Skills match your search." : "No Skills published yet."}
          </p>
        )}
        {skills.isSuccess && rows.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.original.id} className="cursor-pointer" onClick={() => onSelect(row.original.name)}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div ref={sentinelRef} className="h-1" />
            {skills.isFetchingNextPage && (
              <p className="py-2 text-center text-sm text-muted-foreground">Loading more…</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
