import { PASSWORD_MIN_LENGTH } from "@in-org-quicko/skillset-shared";
import { useState, type FormEvent, type ReactNode } from "react";
import { FormDialog, FormDialogBody, FormDialogFooter, FormDialogHeader, FormField } from "@/components/ui/dialog";
import { LabeledField } from "@/components/labeled-field";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useReplaceOwnPassword } from "@/hooks/use-users";
import { apiErrorMessage } from "@/lib/api";

/**
 * The one form that replaces the caller's own password — used both from an
 * ordinary Settings visit and from the forced "you must change your
 * generated password" screen (ticket 11), which passes `description` to
 * explain why it's the only thing on the page.
 */
export function PasswordCard({ description }: { description?: ReactNode }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const replacePassword = useReplaceOwnPassword();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    replacePassword.mutate(
      { current_password: currentPassword, new_password: newPassword },
      {
        onSuccess: () => {
          setCurrentPassword("");
          setNewPassword("");
        },
      },
    );
  }

  return (
    <Panel className="w-full" title="Password" description={description ?? "Change your password at any time."}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <LabeledField label="Current password" htmlFor="current_password">
          <Input
            id="current_password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
            className="h-9"
          />
        </LabeledField>
        <LabeledField
          label="New password"
          htmlFor="new_password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        >
          <Input
            id="new_password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            className="h-9"
          />
        </LabeledField>
        {replacePassword.isError && (
          <p className="text-sm text-destructive">{apiErrorMessage(replacePassword.error)}</p>
        )}
        <Button type="submit" className="w-fit" disabled={replacePassword.isPending}>
          {replacePassword.isPending ? "Replacing…" : "Replace password"}
        </Button>
      </form>
    </Panel>
  );
}

/**
 * The "Change password" dialog Settings opens from the Personal Info tab —
 * the same current/new password pair as {@link PasswordCard}, in the shared
 * `FormDialog` shell instead of an always-visible Panel.
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const replacePassword = useReplaceOwnPassword();

  function handleOpenChange(next: boolean) {
    if (!next) {
      setCurrentPassword("");
      setNewPassword("");
      replacePassword.reset();
    }
    onOpenChange(next);
  }

  function handleSubmit() {
    replacePassword.mutate(
      { current_password: currentPassword, new_password: newPassword },
      { onSuccess: () => handleOpenChange(false) },
    );
  }

  return (
    <FormDialog open={open} onOpenChange={handleOpenChange}>
      <FormDialogHeader title="Change password" description="Enter your current password and choose a new one." />
      <FormDialogBody>
        <FormField htmlFor="dialog_current_password" label="Current password">
          <Input
            id="dialog_current_password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </FormField>
        <FormField
          htmlFor="dialog_new_password"
          label="New password"
          helperText={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        >
          <Input
            id="dialog_new_password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
        </FormField>
        {replacePassword.isError && (
          <p className="text-sm text-destructive">{apiErrorMessage(replacePassword.error)}</p>
        )}
      </FormDialogBody>
      <FormDialogFooter
        onCancel={() => handleOpenChange(false)}
        submit={{
          label: "Change password",
          pendingLabel: "Changing…",
          pending: replacePassword.isPending,
          disabled: currentPassword.length === 0 || newPassword.length < PASSWORD_MIN_LENGTH,
          onClick: handleSubmit,
        }}
      />
    </FormDialog>
  );
}
