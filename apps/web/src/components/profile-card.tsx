import type { User } from "@skill-registry/shared";
import { useState, type FormEvent } from "react";
import { PasswordCard } from "@/components/password-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateOwnName } from "@/hooks/use-users";
import { apiErrorMessage } from "@/lib/api";

/** Any User corrects their own names, and replaces their own password, without an Admin. */
export function ProfileCard({ user }: { user: User }) {
  const [firstName, setFirstName] = useState(user.first_name);
  const [lastName, setLastName] = useState(user.last_name);
  const updateName = useUpdateOwnName();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // The server trims first_name/last_name (UserUpdateNameSchema) — synced
    // back here so the fields show what was actually persisted, not what
    // was typed.
    updateName.mutate(
      { first_name: firstName, last_name: lastName },
      {
        onSuccess: (updated) => {
          setFirstName(updated.first_name);
          setLastName(updated.last_name);
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="first_name">First name</Label>
              <Input
                id="first_name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="last_name">Last name</Label>
              <Input
                id="last_name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                required
              />
            </div>
            {updateName.isError && <p className="text-sm text-destructive">{apiErrorMessage(updateName.error)}</p>}
            <Button type="submit" disabled={updateName.isPending}>
              {updateName.isPending ? "Saving…" : "Save name"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <PasswordCard />
    </div>
  );
}
