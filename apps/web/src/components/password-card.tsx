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
  const [confirmPassword, setConfirmPassword] = useState("");
  const replacePassword = useReplaceOwnPassword();

  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) return;
    replacePassword.mutate(
      { current_password: currentPassword, new_password: newPassword },
      {
        onSuccess: () => {
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
        },
      },
    );
  }

  return (
    <Panel className="w-full" title="Password" description={description ?? "Change your password at any time."} uppercase={false}>
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
        <LabeledField label="Verify password" htmlFor="confirm_password">
          <Input
            id="confirm_password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            aria-invalid={mismatch}
            required
            className="h-9"
          />
        </LabeledField>
        {mismatch && <p className="-mt-2 text-xs text-destructive">Passwords don't match.</p>}
        {replacePassword.isError && (
          <p className="text-sm text-destructive">{apiErrorMessage(replacePassword.error)}</p>
        )}
        <Button
          type="submit"
          className="w-fit"
          disabled={replacePassword.isPending || newPassword.length < PASSWORD_MIN_LENGTH || newPassword !== confirmPassword}
        >
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
  const [confirmPassword, setConfirmPassword] = useState("");
  const replacePassword = useReplaceOwnPassword();

  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  function handleOpenChange(next: boolean) {
    if (!next) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      replacePassword.reset();
    }
    onOpenChange(next);
  }

  function handleSubmit() {
    if (newPassword !== confirmPassword) return;
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
        <FormField
          htmlFor="dialog_confirm_password"
          label="Verify password"
          helperText={mismatch ? <span className="text-destructive">Passwords don't match.</span> : undefined}
        >
          <Input
            id="dialog_confirm_password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            aria-invalid={mismatch}
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
          disabled:
            currentPassword.length === 0 || newPassword.length < PASSWORD_MIN_LENGTH || newPassword !== confirmPassword,
          onClick: handleSubmit,
        }}
      />
    </FormDialog>
  );
}
