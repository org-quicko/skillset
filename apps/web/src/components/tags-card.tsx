import type { Tag } from "@in-org-quicko/skillset-shared";
import { PencilIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { DeleteTagDialog } from "@/components/delete-tag-dialog";
import { EditTagDialog } from "@/components/edit-tag-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTags } from "@/hooks/use-tags";
import { apiErrorMessage } from "@/lib/api";

function TagsTableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-md" />
      ))}
    </div>
  );
}

/**
 * An Admin's view of the Registry's Tag catalog.
 * Lists all catalog tags with filtering and allows renaming or permanently deleting a Tag.
 */
export function TagsCard() {
  const tagsQuery = useTags();
  const [filter, setFilter] = useState("");
  const [editTarget, setEditTarget] = useState<Tag | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null);

  const tags = useMemo(() => tagsQuery.data?.items ?? [], [tagsQuery.data]);

  const filteredTags = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((tag) => tag.name.toLowerCase().includes(q));
  }, [tags, filter]);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Tags</h2>
          <p className="max-w-2xl text-xs text-muted-foreground">
            Manage the shared catalog of tags used for browsing and filtering skills.
          </p>
        </div>
      </div>

      <div className="relative max-w-xs">
        <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Filter tags…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="pl-9 text-xs"
        />
      </div>

      {tagsQuery.isError && <p className="text-sm text-destructive">{apiErrorMessage(tagsQuery.error)}</p>}

      {tagsQuery.isPending && <TagsTableSkeleton />}

      {tagsQuery.isSuccess && (
        <Panel contentClassName="p-0" className="bg-transparent">
          {filteredTags.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {tags.length === 0 ? "No tags in the catalog yet." : "No tags match your filter."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Tag Name</TableHead>
                  <TableHead className="w-28 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTags.map((tag) => (
                  <TableRow key={tag.id} className="hover:bg-transparent">
                    <TableCell className="font-medium">
                      <Badge variant="secondary">{tag.name}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => setEditTarget(tag)}
                          aria-label={`Edit tag ${tag.name}`}
                        >
                          <PencilIcon className="size-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget(tag)}
                          aria-label={`Delete tag ${tag.name}`}
                        >
                          <Trash2Icon className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      )}

      {editTarget && (
        <EditTagDialog
          tag={editTarget}
          open
          onOpenChange={(next) => {
            if (!next) setEditTarget(null);
          }}
        />
      )}

      {deleteTarget && (
        <DeleteTagDialog
          tag={deleteTarget}
          open
          onOpenChange={(next) => {
            if (!next) setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}
