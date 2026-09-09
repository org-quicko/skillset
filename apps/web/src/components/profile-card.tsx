import type { User } from "@skillset/shared";
import { useEffect, useRef, useState } from "react";
import { InfoRow } from "@/components/info-row";
import { ChangePasswordDialog } from "@/components/password-card";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpdateOwnName } from "@/hooks/use-users";
import { apiErrorMessage } from "@/lib/api";

/** How long typing has to pause before an edited name auto-saves. */
const NAME_SAVE_DEBOUNCE_MS = 300;

/** Any User corrects their own names, and replaces their own password, without an Admin. */
export function ProfileCard({ user }: { user: User }) {
  const [firstName, setFirstName] = useState(user.first_name);
  const [lastName, setLastName] = useState(user.last_name);
  const [changingPassword, setChangingPassword] = useState(false);
  const updateName = useUpdateOwnName();

  // Read through a ref so the timer below depends on the typed names alone.
  // Closing over `user`/`updateName` instead would restart the debounce on
  // every unrelated re-render, which is the one thing a debounce must not do.
  const latest = useRef({ user, updateName });
  latest.current = { user, updateName };

  useEffect(() => {
    if (!firstName.trim() || !lastName.trim()) return;

    const timer = setTimeout(() => {
      const { user: current, updateName: save } = latest.current;
      if (firstName === current.first_name && lastName === current.last_name) return;
      // The server trims first_name/last_name (UserUpdateNameSchema) — synced
      // back here so the fields show what was actually persisted, not what
      // was typed.
      save.mutate(
        { first_name: firstName, last_name: lastName },
        {
          onSuccess: (updated) => {
            setFirstName(updated.first_name);
            setLastName(updated.last_name);
          },
        },
      );
    }, NAME_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [firstName, lastName]);

  // The saved name can change without a keystroke here (another session,
  // a failed save reverting) — reflect it, since `firstName`/`lastName`
  // already equal it once our own save round-trips.
  useEffect(() => {
    setFirstName(user.first_name);
    setLastName(user.last_name);
  }, [user.first_name, user.last_name]);

  return (
    <div className="flex flex-col gap-4">
      <Panel contentClassName="p-0">
        <div className="divide-y">
          <InfoRow title="First name">
            <Input
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              required
              className="h-9 w-56"
            />
          </InfoRow>
          <InfoRow title="Last name">
            <Input
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              required
              className="h-9 w-56"
            />
          </InfoRow>
          <InfoRow title="Email">
            <span className="text-sm">{user.email}</span>
          </InfoRow>
        </div>
      </Panel>
      {updateName.isError && <p className="text-sm text-destructive">{apiErrorMessage(updateName.error)}</p>}

      <Panel contentClassName="p-0">
        <InfoRow title="Password" description="Change your password at any time.">
          <Button type="button" variant="outline" onClick={() => setChangingPassword(true)}>
            Change password
          </Button>
        </InfoRow>
      </Panel>
      <ChangePasswordDialog open={changingPassword} onOpenChange={setChangingPassword} />
    </div>
  );
}
