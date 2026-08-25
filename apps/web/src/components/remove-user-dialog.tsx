import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {name}?</DialogTitle>
          <DialogDescription>
            This ends their access immediately. Skills they published remain, still attributed to them.
          </DialogDescription>
        </DialogHeader>
        {deleteUser.isError && <p className="text-sm text-destructive">{apiErrorMessage(deleteUser.error)}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={deleteUser.isPending} onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={deleteUser.isPending}
            onClick={() => deleteUser.mutate(userId, { onSuccess: () => handleOpenChange(false) })}
          >
            {deleteUser.isPending ? "Removing…" : "Remove User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
