import { FormDialog, FormDialogBody, FormDialogFooter, FormDialogHeader } from "@/components/ui/dialog";
import { useDeleteIntegration } from "@/hooks/use-integrations";
import { apiErrorMessage } from "@/lib/api";

/**
 * Confirms removing an Integration's registration with a Git Provider.
 *
 * @remarks
 * The API refuses (409) while a writer still holds a Connection through it
 * (`connections.integration_id` is `ON DELETE RESTRICT`) — that refusal, not
 * a client-side check, is what protects a live grant, so this dialog just
 * surfaces whatever message comes back rather than pre-checking anything.
 */
export function DeleteIntegrationDialog({
  integrationId,
  name,
  open,
  onOpenChange,
}: {
  integrationId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const deleteIntegration = useDeleteIntegration();

  function handleOpenChange(next: boolean) {
    if (!next) deleteIntegration.reset();
    onOpenChange(next);
  }

  return (
    <FormDialog open={open} onOpenChange={handleOpenChange}>
      <FormDialogHeader
        title={`Delete ${name}?`}
        description="This can't be undone. If a writer still holds a Connection through it, the delete is refused until they've disconnected."
      />

      {deleteIntegration.isError && (
        <FormDialogBody>
          <p className="text-sm text-destructive">{apiErrorMessage(deleteIntegration.error)}</p>
        </FormDialogBody>
      )}

      <FormDialogFooter
        onCancel={() => handleOpenChange(false)}
        cancelDisabled={deleteIntegration.isPending}
        submit={{
          label: "Delete Integration",
          pendingLabel: "Deleting…",
          pending: deleteIntegration.isPending,
          variant: "destructive",
          onClick: () =>
            deleteIntegration.mutate(integrationId, { onSuccess: () => handleOpenChange(false) }),
        }}
      />
    </FormDialog>
  );
}
