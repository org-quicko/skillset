import type { Tag } from "@in-org-quicko/skillset-shared";
import { ChevronsUpDownIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { DeleteTagDialog } from "@/components/delete-tag-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * A multi-select Tag filter (ticket 23): selecting several Tags narrows the
 * Skill list to a Skill carrying any one of them, not all of them.
 *
 * @param tags - The whole Tag catalog to choose from (`useTags`).
 * @param selected - The currently selected Tag ids.
 * @param onChange - Called with the full new set of selected ids whenever one is toggled.
 * @param canManageTags - Whether the user can delete a Tag from the catalog (admin or above).
 * @example
 * ```tsx
 * <TagFilter tags={tags.data?.items ?? []} selected={filters.tagIds} onChange={(tagIds) => setTagIds(tagIds)} />
 * ```
 */
export function TagFilter({
  tags,
  selected,
  onChange,
  canManageTags = false,
}: {
  tags: Tag[];
  selected: string[];
  onChange: (tagIds: string[]) => void;
  canManageTags?: boolean;
}) {
  const [tagToDelete, setTagToDelete] = useState<Tag | null>(null);

  function toggle(tagId: string) {
    onChange(selected.includes(tagId) ? selected.filter((id) => id !== tagId) : [...selected, tagId]);
  }

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="justify-between">
            <span className="flex items-center gap-1.5">
              {selected.length === 1
                ? (tags.find((tag) => tag.id === selected[0])?.name ?? "Tags")
                : "Tags"}
              {selected.length > 1 && <Badge variant="secondary">{selected.length}</Badge>}
            </span>
            <ChevronsUpDownIcon className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search Tags..." />
            <CommandList>
              <CommandEmpty>No Tags.</CommandEmpty>
              <CommandGroup>
                {tags.map((tag) => (
                  <CommandItem key={tag.id} value={tag.name} onSelect={() => toggle(tag.id)} className="group flex items-center justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                      <Checkbox checked={selected.includes(tag.id)} />
                      <span className="truncate">{tag.name}</span>
                    </div>
                    {canManageTags && (
                      <button
                        type="button"
                        aria-label={`Delete tag ${tag.name}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setTagToDelete(tag);
                        }}
                        className="ml-auto flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-60 transition-opacity hover:bg-destructive/10 hover:text-destructive hover:opacity-100"
                      >
                        <Trash2Icon className="size-3.5" />
                      </button>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {tagToDelete && (
        <DeleteTagDialog
          tag={tagToDelete}
          open
          onOpenChange={(next) => {
            if (!next) setTagToDelete(null);
          }}
          onDeleted={() => {
            if (tagToDelete && selected.includes(tagToDelete.id)) {
              onChange(selected.filter((id) => id !== tagToDelete.id));
            }
          }}
        />
      )}
    </>
  );
}
