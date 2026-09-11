import { validateTagName, type Tag } from "@in-org-quicko/skillset-shared";
import { XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSetSkillTags, useTags } from "@/hooks/use-tags";
import { apiErrorMessage } from "@/lib/api";

interface DraftTag {
  /** `null` for a name typed fresh this session that doesn't exist in the catalog yet — it can't be reused by id until the add lands and the catalog resolves it. */
  id: string | null;
  name: string;
}

/**
 * Edits a Skill's Tags in place: each add or remove fires its own full
 * replace (`PUT /resources/{id}/tags`) immediately — there's no separate
 * save step. A name can be picked from the catalog autocomplete or typed
 * fresh and confirmed with Enter (find-or-create, ADR-0011).
 *
 * @remarks
 * The dialog shell (`Dialog`/`DialogContent`) is always mounted, matching
 * Radix's own close-transition handling, but the stateful editor body below
 * is not — it's only rendered while `open` is true, so it mounts fresh every
 * time the dialog opens rather than carrying over a previous session's draft
 * (or, worse, an empty one seeded before `tags` had arrived). This is a plain
 * mount/unmount, not an effect: `TagsEditorBody`'s `draftTags` is initialised
 * once, at mount, straight from the `tags` prop already in hand.
 *
 * @param id - The Skill's id.
 * @param name - The Skill's name, shown in the dialog description.
 * @param tags - The Skill's current Tags, seeded into the draft each time the dialog opens.
 * @param open - Whether the dialog is open.
 * @param onOpenChange - Called when the dialog should open or close.
 */
export function EditTagsDialog({
  id,
  name,
  tags,
  open,
  onOpenChange,
}: {
  id: string;
  name: string;
  tags: Tag[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Tags</DialogTitle>
          <DialogDescription>Tags help with browsing and filtering — {name} can carry as many as you like.</DialogDescription>
        </DialogHeader>
        {open && <TagsEditorBody id={id} name={name} tags={tags} />}
      </DialogContent>
    </Dialog>
  );
}

/** Owns every piece of local editing state — split out so it only exists while the dialog is open (see `EditTagsDialog`'s remarks). */
function TagsEditorBody({ id, name, tags }: { id: string; name: string; tags: Tag[] }) {
  const [draftTags, setDraftTags] = useState<DraftTag[]>(() => tags.map((tag) => ({ id: tag.id, name: tag.name })));
  const [query, setQuery] = useState("");
  const [queryError, setQueryError] = useState<string | null>(null);

  const catalog = useTags();
  const setSkillTags = useSetSkillTags();

  const suggestions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed || !catalog.data) return [];
    const draftNames = new Set(draftTags.map((tag) => tag.name));
    return catalog.data.items.filter((tag) => tag.name.includes(trimmed) && !draftNames.has(tag.name)).slice(0, 8);
  }, [query, catalog.data, draftTags]);

  /** Applies a new draft list: updates local state right away and fires the full-replace request in the background. */
  function commit(next: DraftTag[]) {
    setDraftTags(next);
    setSkillTags.mutate({ id, name, tags: next.map((tag) => tag.name) });
  }

  function addTag(candidate: DraftTag) {
    if (draftTags.some((tag) => tag.name === candidate.name)) return;
    commit([...draftTags, candidate]);
    setQuery("");
    setQueryError(null);
  }

  /**
   * Enter in the input while no suggestion matches: validate and normalise
   * locally (the same rule the API enforces), then add. While suggestions
   * are showing, Enter is instead handled by the `Command` list below,
   * which picks whichever suggestion is currently highlighted.
   */
  function handleQuerySubmit() {
    if (!query.trim()) return;
    try {
      const normalized = validateTagName(query);
      const existing = catalog.data?.items.find((tag) => tag.name === normalized);
      addTag(existing ?? { id: null, name: normalized });
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : "That tag name isn't valid.");
    }
  }

  function removeTag(tagName: string) {
    commit(draftTags.filter((tag) => tag.name !== tagName));
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <Label htmlFor="tag-input">Add a tag</Label>
        <div className="relative">
          <Command shouldFilter={false} className="contents">
            <Input
              id="tag-input"
              value={query}
              disabled={setSkillTags.isPending}
              onChange={(event) => {
                setQuery(event.target.value);
                setQueryError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && suggestions.length === 0) {
                  event.preventDefault();
                  handleQuerySubmit();
                }
              }}
              placeholder="Type a name and press Enter…"
              autoComplete="off"
            />
            {suggestions.length > 0 && (
              <CommandList className="absolute z-10 mt-1 w-full rounded-lg border border-input bg-popover shadow-md">
                <CommandGroup>
                  {suggestions.map((tag) => (
                    <CommandItem key={tag.id} value={tag.name} onSelect={() => addTag(tag)}>
                      {tag.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            )}
          </Command>
        </div>
        {queryError && <p className="text-sm text-destructive">{queryError}</p>}

        {draftTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {draftTags.map((tag) => (
              <Badge key={tag.name} variant="secondary">
                {tag.name}
                <button
                  type="button"
                  data-icon="inline-end"
                  disabled={setSkillTags.isPending}
                  onClick={() => removeTag(tag.name)}
                  aria-label={`Remove ${tag.name}`}
                  className="flex cursor-pointer rounded-sm p-0.5 transition-[color,background-color,scale] duration-150 ease-out outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.96] disabled:cursor-not-allowed"
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {setSkillTags.isError && <p className="text-sm text-destructive">{apiErrorMessage(setSkillTags.error)}</p>}
    </>
  );
}
