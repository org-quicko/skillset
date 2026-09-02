import { useState, type FormEvent, type ReactNode } from "react";
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
            className="h-10"
          />
        </LabeledField>
        <LabeledField label="New password" htmlFor="new_password" hint="At least 12 characters.">
          <Input
            id="new_password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            className="h-10"
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
