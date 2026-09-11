import { useState } from "react";
import { FormDialog, FormDialogBody, FormDialogFooter, FormDialogHeader, FormField } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
    <FormDialog open={open} onOpenChange={handleOpenChange}>
      <FormDialogHeader
        title={`Delete ${name}?`}
        description={
          <>
            This removes the Skill and its Artifact for good. There is no undo. Type <strong>{name}</strong> to
            confirm.
          </>
        }
      />

      <FormDialogBody>
        <FormField htmlFor="delete-confirmation" label="Skill name">
          <Input
            id="delete-confirmation"
            placeholder={name}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            disabled={deleteSkill.isPending}
          />
        </FormField>
        {deleteSkill.isError && <p className="text-sm text-destructive">{apiErrorMessage(deleteSkill.error)}</p>}
      </FormDialogBody>

      <FormDialogFooter
        onCancel={() => handleOpenChange(false)}
        cancelDisabled={deleteSkill.isPending}
        submit={{
          label: "Delete Skill",
          pendingLabel: "Deleting…",
          pending: deleteSkill.isPending,
          disabled: confirmation !== name,
          variant: "destructive",
          onClick: () => deleteSkill.mutate({ id, name }, { onSuccess: onDeleted }),
        }}
      />
    </FormDialog>
  );
}
