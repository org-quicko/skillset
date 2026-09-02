import type { User } from "@skill-registry/shared";
import { useState, type FormEvent } from "react";
import { LabeledField } from "@/components/labeled-field";
import { PasswordCard } from "@/components/password-card";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <div className="flex max-w-xl flex-col gap-4">
      <Panel title="Profile">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <LabeledField label="Email">
            <Input value={user.email} readOnly disabled className="h-10" />
          </LabeledField>
          <div className="grid gap-4 sm:grid-cols-2">
            <LabeledField label="First name" htmlFor="first_name">
              <Input
                id="first_name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                required
                className="h-10"
              />
            </LabeledField>
            <LabeledField label="Last name" htmlFor="last_name">
              <Input
                id="last_name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                required
                className="h-10"
              />
            </LabeledField>
          </div>
          {updateName.isError && <p className="text-sm text-destructive">{apiErrorMessage(updateName.error)}</p>}
          <Button type="submit" className="w-fit" disabled={updateName.isPending}>
            {updateName.isPending ? "Saving…" : "Save name"}
          </Button>
        </form>
      </Panel>

      <PasswordCard />
    </div>
  );
}
