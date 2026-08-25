import { PasswordCard } from "@/components/password-card";
import { Button } from "@/components/ui/button";
import { useLogout } from "@/hooks/use-auth";

/**
 * Shown instead of the rest of the app while a generated password is still
 * pending replacement (ticket 11) — the API refuses every other route until
 * this one resolves it, so there is nothing else to offer here except
 * signing out of the session instead.
 */
export function ChangePasswordRequired() {
  const logout = useLogout();

  return (
    <div className="flex flex-col items-center gap-4">
      <h1 className="text-lg font-semibold tracking-tight">Choose a password</h1>
      <PasswordCard description="An Admin created your account with a generated password. Replace it to continue." />
      <Button variant="ghost" size="sm" onClick={() => logout.mutate()} disabled={logout.isPending}>
        {logout.isPending ? "Signing out…" : "Sign out instead"}
      </Button>
    </div>
  );
}
