import { validateTagName, type Tag } from "@in-org-quicko/skillset-shared";
import { useState } from "react";
import {
  FormDialog,
  FormDialogBody,
  FormDialogFooter,
  FormDialogHeader,
  FormField,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useRenameTag } from "@/hooks/use-tags";
import { apiErrorMessage } from "@/lib/api";

/**
 * Dialog for renaming an existing Tag across the catalog.
 *
 * @param props - Dialog properties including current Tag and visibility handlers.
 * @param props.tag - The Tag to rename, or null when closed.
 * @param props.open - Whether the dialog is open.
 * @param props.onOpenChange - Callback when dialog open state changes.
 * @param props.onRenamed - Optional callback invoked with the new name upon successful rename.
 *
 * @remarks
 * Renaming a tag is an Admin action that updates the tag in the shared catalog
 * and cascades to every skill carrying it. The dialog body mounts only while open
 * so state is fresh each session.
 *
 * @example
 * ```tsx
 * <EditTagDialog
 *   tag={selectedTag}
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   onRenamed={(newName) => console.log(newName)}
 * />
 * ```
 */
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
  if (!tag) return null;

  return (
    <FormDialog open={open} onOpenChange={onOpenChange}>
      <FormDialogHeader
        title={`Edit tag "${tag.name}"`}
        description="Renaming this tag updates it in the catalog and across every skill carrying it."
      />
      {open && (
        <EditTagDialogBody tag={tag} onClose={() => onOpenChange(false)} onRenamed={onRenamed} />
      )}
    </FormDialog>
  );
}

function EditTagDialogBody({
  tag,
  onClose,
  onRenamed,
}: {
  tag: Tag;
  onClose: () => void;
  onRenamed?: (newName: string) => void;
}) {
  const [name, setName] = useState(tag.name);
  const [error, setError] = useState<string | null>(null);
  const renameTag = useRenameTag();

  function handleSubmit() {
    let normalized = "";
    try {
      normalized = validateTagName(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid tag name.");
      return;
    }

    if (normalized === tag.name) {
      onClose();
      return;
    }

    renameTag.mutate(
      { id: tag.id, name: normalized },
      {
        onSuccess: () => {
          onClose();
          onRenamed?.(normalized);
        },
      },
    );
  }

  const isUnchanged = name.trim().toLowerCase() === tag.name;

  return (
    <>
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
            autoFocus
          />
        </FormField>

        {renameTag.isError && (
          <p className="text-sm text-destructive">{apiErrorMessage(renameTag.error)}</p>
        )}
      </FormDialogBody>

      <FormDialogFooter
        onCancel={onClose}
        cancelDisabled={renameTag.isPending}
        submit={{
          label: "Save Changes",
          pendingLabel: "Saving…",
          pending: renameTag.isPending,
          disabled: !name.trim() || isUnchanged,
          onClick: handleSubmit,
        }}
      />
    </>
  );
}
