import type { User } from "@skill-registry/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLogout } from "@/hooks/use-auth";

export function AuthenticatedHome({ user }: { user: User }) {
  const logout = useLogout();

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          {user.first_name} {user.last_name}
        </CardTitle>
        <CardDescription>
          {user.email} — {user.role}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={() => logout.mutate()} disabled={logout.isPending}>
          {logout.isPending ? "Logging out…" : "Log out"}
        </Button>
      </CardContent>
    </Card>
  );
}
