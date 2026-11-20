import { FormDialog, FormDialogBody, FormDialogFooter, FormDialogHeader } from "@/components/ui/dialog";
import { useDeleteTag } from "@/hooks/use-tags";
import { apiErrorMessage } from "@/lib/api";

/** Confirms deleting a Tag from the catalog — cascades to every Skill carrying it. */
export function DeleteTagDialog({
  tag,
  open,
  onOpenChange,
  onDeleted,
}: {
  tag: { id: string; name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const deleteTag = useDeleteTag();

  function handleOpenChange(next: boolean) {
    if (!next) deleteTag.reset();
    onOpenChange(next);
  }

  if (!tag) return null;

  return (
    <FormDialog open={open} onOpenChange={handleOpenChange}>
      <FormDialogHeader
        title={`Delete tag "${tag.name}"?`}
        description="This removes the tag from the catalog and detaches it from every skill carrying it. There is no undo."
      />

      {deleteTag.isError && (
        <FormDialogBody>
          <p className="text-sm text-destructive">{apiErrorMessage(deleteTag.error)}</p>
        </FormDialogBody>
      )}

      <FormDialogFooter
        onCancel={() => handleOpenChange(false)}
        cancelDisabled={deleteTag.isPending}
        submit={{
          label: "Delete Tag",
          pendingLabel: "Deleting…",
          pending: deleteTag.isPending,
          variant: "destructive",
          onClick: () =>
            deleteTag.mutate(tag.id, {
              onSuccess: () => {
                handleOpenChange(false);
                onDeleted?.();
              },
            }),
        }}
      />
    </FormDialog>
  );
}
