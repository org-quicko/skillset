import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDeleteSkill } from "@/hooks/use-skills";
import { apiErrorMessage } from "@/lib/api";

/**
 * The one irreversible action in the Registry (spec, ticket 12) — typing the
 * Skill's name back is the deliberation the spec asks for, not a mechanism
 * to prevent misuse (the name is right there on the page).
 *
 * @param id - The Skill's id — what the delete request is sent to (ticket 16).
 * @param name - The Skill's name; what the confirmation input is checked against.
 * @param open - Whether the dialog is open.
 * @param onOpenChange - Called when the dialog's open state should change.
 * @param onDeleted - Called once the Skill has been deleted.
 */
export function DeleteSkillDialog({
  id,
  name,
  open,
  onOpenChange,
  onDeleted,
}: {
  id: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const deleteSkill = useDeleteSkill();

  function handleOpenChange(next: boolean) {
    if (!next) {
      setConfirmation("");
      deleteSkill.reset();
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {name}?</DialogTitle>
          <DialogDescription>
            This removes the Skill and its Artifact for good. There is no undo. Type <strong>{name}</strong> to
            confirm.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="delete-confirmation">Skill name</Label>
          <Input
            id="delete-confirmation"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            disabled={deleteSkill.isPending}
          />
        </div>
        {deleteSkill.isError && <p className="text-sm text-destructive">{apiErrorMessage(deleteSkill.error)}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={deleteSkill.isPending} onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={confirmation !== name || deleteSkill.isPending}
            onClick={() => deleteSkill.mutate({ id, name }, { onSuccess: onDeleted })}
          >
            {deleteSkill.isPending ? "Deleting…" : "Delete Skill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
