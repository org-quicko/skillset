import { FormDialog, FormDialogBody, FormDialogFooter, FormDialogHeader } from "@/components/ui/dialog";
import { useDeleteUser } from "@/hooks/use-users";
import { apiErrorMessage } from "@/lib/api";

/** Ends a User's access. Skills they published remain, attributed by their email snapshot (ticket 11). */
export function RemoveUserDialog({
  userId,
  name,
  open,
  onOpenChange,
}: {
  userId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const deleteUser = useDeleteUser();

  function handleOpenChange(next: boolean) {
    if (!next) deleteUser.reset();
    onOpenChange(next);
  }

  return (
    <FormDialog open={open} onOpenChange={handleOpenChange}>
      <FormDialogHeader
        title={`Remove ${name}?`}
        description="This ends their access immediately. Skills they published remain, still attributed to them."
      />

      {deleteUser.isError && (
        <FormDialogBody>
          <p className="text-sm text-destructive">{apiErrorMessage(deleteUser.error)}</p>
        </FormDialogBody>
      )}

      <FormDialogFooter
        onCancel={() => handleOpenChange(false)}
        cancelDisabled={deleteUser.isPending}
        submit={{
          label: "Remove User",
          pendingLabel: "Removing…",
          pending: deleteUser.isPending,
          variant: "destructive",
          onClick: () => deleteUser.mutate(userId, { onSuccess: () => handleOpenChange(false) }),
        }}
      />
    </FormDialog>
  );
}
