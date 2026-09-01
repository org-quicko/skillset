import { loginRefusalMessage, type PublicIdentityProvider } from "@skill-registry/shared";
import { useState, type FormEvent } from "react";
import { PROVIDER_ICONS } from "@/components/provider-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLogin } from "@/hooks/use-auth";
import { useLoginProviders } from "@/hooks/use-identity-providers";
import { ApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "@/lib/use-router";

/**
 * Starts an external login. Better Auth answers with the provider's
 * authorization URL and the browser leaves the app for it — a top-level
 * navigation, not a client-side route change, because the provider is a
 * different origin.
 */
function startExternalLogin(kind: string): void {
  void authClient.signIn.social({ provider: kind, callbackURL: "/" });
}

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();
  const providers = useLoginProviders();
  const { search } = useRouter();

  // Set by the API when it bounces a failed external login back here. The code
  // names which check refused it, so the message can be the one that helps —
  // an unapproved OAuth app and a wrong organisation look identical to the
  // person hitting them but are fixed in completely different places.
  const externalError = search.get("error");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    login.mutate({ email, password });
  }

  const items = providers.data?.items ?? [];

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Log in</CardTitle>
        <CardDescription>Sign in to Skillset.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {externalError && (
          <p className="text-sm text-destructive">{loginRefusalMessage(externalError)}</p>
        )}

        {/* Above the password form, and the password form is always present:
            it is the way back in when a provider is misconfigured or its
            client secret has expired (ADR-0015). */}
        {items.length > 0 && (
          <>
            <div className="flex flex-col gap-2">
              {items.map((provider) => (
                <ProviderButton key={provider.kind} provider={provider} />
              ))}
            </div>
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          {login.isError && (
            <p className="text-sm text-destructive">
              {login.error instanceof ApiError ? login.error.message : "Something went wrong."}
            </p>
          )}
          <Button type="submit" disabled={login.isPending}>
            {login.isPending ? "Logging in…" : "Log in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ProviderButton({ provider }: { provider: PublicIdentityProvider }) {
  const Icon = PROVIDER_ICONS[provider.kind];

  return (
    <Button type="button" variant="outline" onClick={() => startExternalLogin(provider.kind)}>
      <Icon className="size-4" />
      Continue with {provider.display_name}
    </Button>
  );
}
