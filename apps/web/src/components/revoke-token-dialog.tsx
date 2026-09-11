import { FormDialog, FormDialogBody, FormDialogFooter, FormDialogHeader } from "@/components/ui/dialog";
import { useRevokeToken } from "@/hooks/use-tokens";
import { apiErrorMessage } from "@/lib/api";

/** Confirms revoking a Token — any CLI signed in with it loses access as soon as this succeeds. */
export function RevokeTokenDialog({
  tokenId,
  name,
  open,
  onOpenChange,
}: {
  tokenId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const revokeToken = useRevokeToken();

  function handleOpenChange(next: boolean) {
    if (!next) revokeToken.reset();
    onOpenChange(next);
  }

  return (
    <FormDialog open={open} onOpenChange={handleOpenChange}>
      <FormDialogHeader
        title={`Revoke "${name}"?`}
        description="Any CLI signed in with this token loses access immediately. This can't be undone, but you can generate a new token any time."
      />

      {revokeToken.isError && (
        <FormDialogBody>
          <p className="text-sm text-destructive">{apiErrorMessage(revokeToken.error)}</p>
        </FormDialogBody>
      )}

      <FormDialogFooter
        onCancel={() => handleOpenChange(false)}
        cancelDisabled={revokeToken.isPending}
        submit={{
          label: "Revoke Token",
          pendingLabel: "Revoking…",
          pending: revokeToken.isPending,
          variant: "destructive",
          onClick: () => revokeToken.mutate(tokenId, { onSuccess: () => handleOpenChange(false) }),
        }}
      />
    </FormDialog>
  );
}
