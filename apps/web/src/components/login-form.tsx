import type { PublicIdentityProvider } from "@skill-registry/shared";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLogin } from "@/hooks/use-auth";
import { useLoginProviders } from "@/hooks/use-identity-providers";
import { ApiError } from "@/lib/api";
import { useRouter } from "@/lib/use-router";

/**
 * Every failure of an external login lands here with the same message. The API
 * does not say which check failed, so neither does this — the person can act
 * no differently either way, and the reason is in the server's logs.
 */
const EXTERNAL_LOGIN_MESSAGE: Record<string, string> = {
  public_url_not_configured:
    "This Registry is not configured for external sign-in yet. Ask an admin to set PUBLIC_URL.",
};

const DEFAULT_EXTERNAL_LOGIN_MESSAGE = "That sign-in could not be completed. Try again, or use your password.";

/**
 * Starts an external login by leaving the app entirely: the browser has to
 * make a top-level navigation to the provider, so this is a full page load
 * rather than a client-side route change.
 */
function startExternalLogin(slug: string): void {
  window.location.assign(`/api/auth/providers/${encodeURIComponent(slug)}/start`);
}

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();
  const providers = useLoginProviders();
  const { search } = useRouter();

  // Set by the API when it bounces a failed external login back here.
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
        <CardDescription>Sign in to the Skill Registry.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {externalError && (
          <p className="text-sm text-destructive">
            {EXTERNAL_LOGIN_MESSAGE[externalError] ?? DEFAULT_EXTERNAL_LOGIN_MESSAGE}
          </p>
        )}

        {/* Above the password form, and the password form is always present:
            it is the way back in when a provider is misconfigured or its
            client secret has expired (ADR-0015). */}
        {items.length > 0 && (
          <>
            <div className="flex flex-col gap-2">
              {items.map((provider) => (
                <ProviderButton key={provider.slug} provider={provider} />
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
  return (
    <Button type="button" variant="outline" onClick={() => startExternalLogin(provider.slug)}>
      Continue with {provider.display_name}
    </Button>
  );
}
