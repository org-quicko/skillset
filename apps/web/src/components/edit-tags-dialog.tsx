import { validateTagName, type Tag } from "@skillset/shared";
import { PencilIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRenameTag, useSetSkillTags, useTags } from "@/hooks/use-tags";
import { apiErrorMessage } from "@/lib/api";

interface DraftTag {
  /** `null` for a name typed fresh this session that doesn't exist in the catalog yet — it can't be renamed until it's saved and has a real id. */
  id: string | null;
  name: string;
}

/**
 * Edits a Skill's Tags as one local draft list, submitted as a single full
 * replace (`PUT /resources/{id}/tags`) once "Save tags" is pressed — nothing
 * is written until then. A name can be picked from the catalog autocomplete
 * or typed fresh (find-or-create, ADR-0011). Admins additionally get a
 * rename control on each existing chip; a rename takes effect immediately
 * (it's a separate, catalog-wide request, `PATCH /tags/{id}`) rather than
 * waiting for "Save tags", since it reaches every Skill carrying that Tag,
 * not just this one.
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
 * @param canRenameTags - Whether the signed-in User may rename a Tag (admin or above).
 * @param open - Whether the dialog is open.
 * @param onOpenChange - Called when the dialog should open or close.
 */
export function EditTagsDialog({
  id,
  name,
  tags,
  canRenameTags,
  open,
  onOpenChange,
}: {
  id: string;
  name: string;
  tags: Tag[];
  canRenameTags: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit tags</DialogTitle>
          <DialogDescription>Tags help with browsing and filtering — {name} can carry as many as you like.</DialogDescription>
        </DialogHeader>
        {open && (
          <TagsEditorBody id={id} name={name} tags={tags} canRenameTags={canRenameTags} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Owns every piece of local editing state — split out so it only exists while the dialog is open (see `EditTagsDialog`'s remarks). */
function TagsEditorBody({
  id,
  name,
  tags,
  canRenameTags,
  onDone,
}: {
  id: string;
  name: string;
  tags: Tag[];
  canRenameTags: boolean;
  onDone: () => void;
}) {
  const [draftTags, setDraftTags] = useState<DraftTag[]>(() => tags.map((tag) => ({ id: tag.id, name: tag.name })));
  const [query, setQuery] = useState("");
  const [queryError, setQueryError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const catalog = useTags();
  const setSkillTags = useSetSkillTags();
  const renameTag = useRenameTag();

  const suggestions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed || !catalog.data) return [];
    const draftNames = new Set(draftTags.map((tag) => tag.name));
    return catalog.data.items.filter((tag) => tag.name.includes(trimmed) && !draftNames.has(tag.name)).slice(0, 8);
  }, [query, catalog.data, draftTags]);

  function addTag(candidate: DraftTag) {
    setDraftTags((current) => (current.some((tag) => tag.name === candidate.name) ? current : [...current, candidate]));
    setQuery("");
    setQueryError(null);
  }

  /** Enter in the input: validate and normalise locally (the same rule the API enforces), then add — reusing an existing catalog Tag by name if there's a match. */
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
    setDraftTags((current) => current.filter((tag) => tag.name !== tagName));
  }

  function startRename(tag: DraftTag) {
    if (!tag.id) return;
    setRenamingId(tag.id);
    setRenameValue(tag.name);
  }

  function submitRename(tag: DraftTag) {
    if (!tag.id || renameValue.trim() === tag.name) {
      setRenamingId(null);
      return;
    }
    renameTag.mutate(
      { id: tag.id, name: renameValue },
      {
        onSuccess: (renamed) => {
          setDraftTags((current) => current.map((t) => (t.id === renamed.id ? { id: renamed.id, name: renamed.name } : t)));
          setRenamingId(null);
        },
      },
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        {draftTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {draftTags.map((tag) => (
              <span
                key={tag.name}
                className="flex items-center gap-1.5 rounded-full bg-muted py-1 pr-1.5 pl-2.5 text-xs text-muted-foreground"
              >
                {tag.id !== null && renamingId === tag.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    disabled={renameTag.isPending}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submitRename(tag);
                      if (event.key === "Escape") setRenamingId(null);
                    }}
                    onBlur={() => submitRename(tag)}
                    className="w-20 bg-transparent outline-none"
                  />
                ) : (
                  <span>{tag.name}</span>
                )}
                {canRenameTags && tag.id && renamingId !== tag.id && (
                  <button
                    type="button"
                    onClick={() => startRename(tag)}
                    aria-label={`Rename ${tag.name}`}
                    className="flex rounded-full p-1 text-muted-foreground transition-[color,background-color,scale] duration-150 ease-out outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.96]"
                  >
                    <PencilIcon className="size-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeTag(tag.name)}
                  aria-label={`Remove ${tag.name}`}
                  className="flex rounded-full p-1 text-muted-foreground transition-[color,background-color,scale] duration-150 ease-out outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.96]"
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <Label htmlFor="tag-input">Add a tag</Label>
        <div className="relative">
          <Input
            id="tag-input"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setQueryError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleQuerySubmit();
              }
            }}
            placeholder="Type a name and press Enter…"
            autoComplete="off"
          />
          {suggestions.length > 0 && (
            <div className="absolute z-10 mt-1 flex w-full flex-col rounded-lg border border-input bg-popover shadow-md">
              {suggestions.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => addTag(tag)}
                  className="px-2.5 py-1.5 text-left text-sm hover:bg-muted"
                >
                  {tag.name}
                </button>
              ))}
            </div>
          )}
        </div>
        {queryError && <p className="text-sm text-destructive">{queryError}</p>}
      </div>

      {setSkillTags.isError && <p className="text-sm text-destructive">{apiErrorMessage(setSkillTags.error)}</p>}
      {renameTag.isError && <p className="text-sm text-destructive">{apiErrorMessage(renameTag.error)}</p>}

      <DialogFooter>
        <Button type="button" variant="ghost" disabled={setSkillTags.isPending} onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={setSkillTags.isPending}
          onClick={() =>
            setSkillTags.mutate({ id, name, tags: draftTags.map((tag) => tag.name) }, { onSuccess: onDone })
          }
        >
          {setSkillTags.isPending ? "Saving…" : "Save tags"}
        </Button>
      </DialogFooter>
    </>
  );
}
