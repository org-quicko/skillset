import { ASSIGNABLE_ROLES, type AssignableRole } from "@skill-registry/shared";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateUser } from "@/hooks/use-users";
import { apiErrorMessage } from "@/lib/api";

/**
 * An Admin's "Add a User" flow (ticket 11) — mirrors `TokensCard`'s
 * mint-then-reveal-once shape: the generated initial password is shown
 * exactly once, in component state, and never written to the query cache.
 */
export function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>("reader");
  const [created, setCreated] = useState<{ email: string; initial_password: string } | null>(null);

  const createUser = useCreateUser((result) =>
    setCreated({ email: result.user.email, initial_password: result.initial_password }),
  );

  function handleOpenChange(next: boolean) {
    if (!next) {
      setFirstName("");
      setLastName("");
      setEmail("");
      setRole("reader");
      setCreated(null);
      createUser.reset();
    }
    onOpenChange(next);
  }

  const canSubmit = firstName.trim() !== "" && lastName.trim() !== "" && email.trim() !== "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{created ? "User created" : "Add a User"}</DialogTitle>
          <DialogDescription>
            {created
              ? "Copy this password now — it is shown once and cannot be retrieved again."
              : "The Registry generates an initial password. The new User must replace it before doing anything else."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <p className="text-sm font-medium">{created.email}</p>
            <code className="break-all rounded bg-muted p-2 text-xs">{created.initial_password}</code>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new_user_first_name">First name</Label>
              <Input
                id="new_user_first_name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                disabled={createUser.isPending}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new_user_last_name">Last name</Label>
              <Input
                id="new_user_last_name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                disabled={createUser.isPending}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new_user_email">Email</Label>
              <Input
                id="new_user_email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={createUser.isPending}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new_user_role">Role</Label>
              <Select
                value={role}
                onValueChange={(value) => setRole(value as AssignableRole)}
                disabled={createUser.isPending}
              >
                <SelectTrigger id="new_user_role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {createUser.isError && <p className="text-sm text-destructive">{apiErrorMessage(createUser.error)}</p>}
          </div>
        )}

        <DialogFooter>
          {created ? (
            <Button type="button" onClick={() => handleOpenChange(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!canSubmit || createUser.isPending}
                onClick={() => createUser.mutate({ first_name: firstName, last_name: lastName, email, role })}
              >
                {createUser.isPending ? "Creating…" : "Create User"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
