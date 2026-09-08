import { loginRefusalMessage, type PublicIdentityProvider } from "@skillset/shared";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { PROVIDER_ICONS } from "@/components/provider-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs tracking-[0.1em] text-muted-foreground uppercase">{children}</span>;
}

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const login = useLogin();
  const providers = useLoginProviders();
  const { search, navigate } = useRouter();

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
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-[54px] w-full max-w-[1200px] items-center px-7">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="cursor-pointer font-wordmark text-2xl tracking-[0.04em] uppercase outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            SKILLSET
          </button>
        </div>
      </header>

      <div className="flex flex-1 items-start justify-center px-7 py-20 sm:py-24">
        <div className="flex w-full max-w-[400px] flex-col gap-6">
          <h1 className="text-[22px] font-medium tracking-tight">Sign in</h1>

          {externalError && <p className="text-sm text-destructive">{loginRefusalMessage(externalError)}</p>}

          {/* Above the password form, and the password form is always present:
              it is the way back in when a provider is misconfigured or its
              client secret has expired (ADR-0015). */}
          {items.length > 0 && (
            <>
              <div className="flex flex-col gap-2.5">
                {items.map((provider) => (
                  <ProviderButton key={provider.kind} provider={provider} />
                ))}
              </div>
              <div className="flex items-center gap-3.5">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs tracking-[0.1em] text-muted-foreground uppercase">or</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          <form className="flex flex-col gap-3.5" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Email</FieldLabel>
              <Input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="h-11"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <FieldLabel>Password</FieldLabel>
              <div className="relative">
                <Input
                  type={reveal ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  className="h-11 pr-10"
                />
                <button
                  type="button"
                  aria-label={reveal ? "Hide password" : "Show password"}
                  onClick={() => setReveal((value) => !value)}
                  className="absolute top-1/2 right-1 flex -translate-y-1/2 cursor-pointer rounded-md p-2 text-muted-foreground transition-[color,scale] duration-150 ease-out outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.96]"
                >
                  {reveal ? <EyeOffIcon strokeWidth={1.75} className="size-[18px]" /> : <EyeIcon strokeWidth={1.75} className="size-[18px]" />}
                </button>
              </div>
            </div>

            {login.isError && (
              <p className="text-sm text-destructive">
                {login.error instanceof ApiError ? login.error.message : "Something went wrong."}
              </p>
            )}

            <Button type="submit" size="lg" className="mt-1 h-11 w-full" disabled={login.isPending}>
              {login.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function ProviderButton({ provider }: { provider: PublicIdentityProvider }) {
  const Icon = PROVIDER_ICONS[provider.kind];

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className="h-11 w-full"
      onClick={() => startExternalLogin(provider.kind)}
    >
      <Icon className="size-4" />
      Continue with {provider.display_name}
    </Button>
  );
}
