import { ASSIGNABLE_ROLES, type AssignableRole } from "@in-org-quicko/skillset-shared";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { FormDialog, FormDialogBody, FormDialogFooter, FormDialogHeader, FormField } from "@/components/ui/dialog";
import { IconSwap } from "@/components/icon-swap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const [copied, setCopied] = useState(false);

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
      setCopied(false);
      createUser.reset();
    }
    onOpenChange(next);
  }

  async function copyPassword() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.initial_password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked — the password is on screen to copy by hand.
    }
  }

  const canSubmit = firstName.trim() !== "" && lastName.trim() !== "" && email.trim() !== "";

  return (
    <FormDialog open={open} onOpenChange={handleOpenChange}>
      <FormDialogHeader
        title={created ? `Password for ${created.email}` : "Add a User"}
        description={
          created
            ? "This password is shown once and can't be retrieved again."
            : "Skillset generates an initial password for them. They must replace it before doing anything else."
        }
      />

      {created ? (
        <FormDialogBody>
          <FormField htmlFor="new_user_password" label="Password">
            <div className="flex items-center gap-2">
              <code
                id="new_user_password"
                className="flex-1 rounded bg-muted p-2 font-mono text-xs break-all"
              >
                {created.initial_password}
              </code>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Copy password"
                onClick={copyPassword}
              >
                <IconSwap
                  showAlt={copied}
                  base={<CopyIcon className="size-4" />}
                  alt={<CheckIcon className="size-4" />}
                />
              </Button>
            </div>
          </FormField>
        </FormDialogBody>
      ) : (
        <FormDialogBody>
          <FormField htmlFor="new_user_first_name" label="First name">
            <Input
              id="new_user_first_name"
              placeholder="Eg. Jane"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              disabled={createUser.isPending}
            />
          </FormField>
          <FormField htmlFor="new_user_last_name" label="Last name">
            <Input
              id="new_user_last_name"
              placeholder="Eg. Doe"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              disabled={createUser.isPending}
            />
          </FormField>
          <FormField htmlFor="new_user_email" label="Email">
            <Input
              id="new_user_email"
              type="email"
              placeholder="Eg. jane.doe@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={createUser.isPending}
            />
          </FormField>
          <FormField htmlFor="new_user_role" label="Role">
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
          </FormField>
          {createUser.isError && <p className="text-sm text-destructive">{apiErrorMessage(createUser.error)}</p>}
        </FormDialogBody>
      )}

      {created ? (
        <FormDialogFooter>
          <Button type="button" onClick={() => handleOpenChange(false)}>
            Done
          </Button>
        </FormDialogFooter>
      ) : (
        <FormDialogFooter
          onCancel={() => handleOpenChange(false)}
          submit={{
            label: "Create User",
            pendingLabel: "Creating…",
            pending: createUser.isPending,
            disabled: !canSubmit,
            onClick: () => createUser.mutate({ first_name: firstName, last_name: lastName, email, role }),
          }}
        />
      )}
    </FormDialog>
  );
}
