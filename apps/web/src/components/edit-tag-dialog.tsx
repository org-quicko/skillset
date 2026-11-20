import { validateTagName, type Tag } from "@in-org-quicko/skillset-shared";
import { useEffect, useState } from "react";
import { FormDialog, FormDialogBody, FormDialogFooter, FormDialogHeader, FormField } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useRenameTag } from "@/hooks/use-tags";
import { apiErrorMessage } from "@/lib/api";

/** Renames a Tag in place in the catalog — cascades to every Skill carrying it. */
export function EditTagDialog({
  tag,
  open,
  onOpenChange,
  onRenamed,
}: {
  tag: Tag | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRenamed?: (newName: string) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const renameTag = useRenameTag();

  useEffect(() => {
    if (tag && open) {
      setName(tag.name);
      setError(null);
      renameTag.reset();
    }
  }, [tag, open, renameTag]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      renameTag.reset();
      setError(null);
    }
    onOpenChange(next);
  }

  if (!tag) return null;

  function handleSubmit() {
    if (!tag) return;
    let normalized = "";
    try {
      normalized = validateTagName(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid tag name.");
      return;
    }

    if (normalized === tag?.name) {
      handleOpenChange(false);
      return;
    }

    renameTag.mutate(
      { id: tag.id, name: normalized },
      {
        onSuccess: () => {
          handleOpenChange(false);
          onRenamed?.(normalized);
        },
      },
    );
  }

  const isUnchanged = name.trim().toLowerCase() === tag.name;

  return (
    <FormDialog open={open} onOpenChange={handleOpenChange}>
      <FormDialogHeader
        title={`Edit tag "${tag.name}"`}
        description="Renaming this tag updates it in the catalog and across every skill carrying it."
      />

      <FormDialogBody>
        <FormField
          htmlFor="edit_tag_name"
          label="Tag name"
          helperText={error ? <span className="text-destructive">{error}</span> : null}
        >
          <Input
            id="edit_tag_name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
            disabled={renameTag.isPending}
            placeholder="eg. frontend"
          />
        </FormField>

        {renameTag.isError && (
          <p className="text-sm text-destructive">{apiErrorMessage(renameTag.error)}</p>
        )}
      </FormDialogBody>

      <FormDialogFooter
        onCancel={() => handleOpenChange(false)}
        cancelDisabled={renameTag.isPending}
        submit={{
          label: "Save Changes",
          pendingLabel: "Saving…",
          pending: renameTag.isPending,
          disabled: !name.trim() || isUnchanged,
          onClick: handleSubmit,
        }}
      />
    </FormDialog>
  );
}
