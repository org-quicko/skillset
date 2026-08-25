import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>{description ?? "Change your password at any time."}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="current_password">Current password</Label>
            <Input
              id="current_password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new_password">New password</Label>
            <Input
              id="new_password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </div>
          {replacePassword.isError && (
            <p className="text-sm text-destructive">{apiErrorMessage(replacePassword.error)}</p>
          )}
          <Button type="submit" disabled={replacePassword.isPending}>
            {replacePassword.isPending ? "Replacing…" : "Replace password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
