import { useEffect, type ReactNode } from "react";
import type { User } from "@skill-registry/shared";
import { BootstrapForm } from "@/components/bootstrap-form";
import { ChangePasswordRequired } from "@/components/change-password-required";
import { Header } from "@/components/header";
import { LoginForm } from "@/components/login-form";
import { SettingsPage } from "@/components/settings-page";
import { SkillsPanel } from "@/components/skills-panel";
import { Spinner } from "@/components/ui/spinner";
import { useCurrentUser, useSetupState } from "@/hooks/use-auth";
import { LOGIN_PATH } from "@/lib/routes";
import { useRouter } from "@/lib/use-router";

const SETTINGS_PATH = "/settings";
const SETTINGS_PATH_PREFIX = "/settings/";

/** True for `/settings` itself and any of its sub-paths — never a merely-prefixed path like `/settings-export`. */
function isSettingsPath(pathname: string): boolean {
  return pathname === SETTINGS_PATH || pathname.startsWith(SETTINGS_PATH_PREFIX);
}

function CenteredPage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">{children}</div>;
}

/** The site chrome every public and signed-in page shares: top nav, content, footer. */
function SiteShell({ user, children }: { user: User | null; children: ReactNode }) {
  const { navigate } = useRouter();
  return (
    <div className="flex min-h-svh flex-col">
      <Header user={user} onOpenSettings={() => navigate(SETTINGS_PATH)} />
      <main className="flex-1">{children}</main>
    </div>
  );
}

function App() {
  const setup = useSetupState();
  const initialized = setup.data?.initialized ?? false;
  const me = useCurrentUser(setup.isSuccess && initialized);
  const { pathname, replace } = useRouter();

  const isSignedOut = setup.isSuccess && initialized && me.isSuccess && !me.data;
  const isSignedIn = setup.isSuccess && initialized && me.isSuccess && !!me.data;

  // A signed-in visitor who lands on /login (e.g. the back button after
  // logging in) is bounced home; a signed-out visitor who asks for /settings
  // is sent to sign in. Reads elsewhere need no session (ADR-0013), so there
  // is no blanket redirect off the rest of the site. `replace`, not
  // `navigate` — these are corrections, not history the back button steps
  // through.
  useEffect(() => {
    if (isSignedIn && pathname === LOGIN_PATH) replace("/");
    else if (isSignedOut && isSettingsPath(pathname)) replace(LOGIN_PATH);
  }, [isSignedIn, isSignedOut, pathname, replace]);

  if (setup.isLoading || me.isLoading)
    return (
      <CenteredPage>
        <Spinner className="size-6" />
      </CenteredPage>
    );

  if (setup.isSuccess && !initialized) {
    return (
      <CenteredPage>
        <BootstrapForm />
      </CenteredPage>
    );
  }

  // A generated password that hasn't been replaced yet blocks every other
  // route (docs/data-model.md) — there is nothing else to offer until it is.
  if (isSignedIn && me.data?.must_change_password) {
    return (
      <CenteredPage>
        <ChangePasswordRequired />
      </CenteredPage>
    );
  }

  if (pathname === LOGIN_PATH) {
    return isSignedIn ? <CenteredPage>{null}</CenteredPage> : <LoginForm />;
  }

  if (isSettingsPath(pathname)) {
    if (!isSignedIn || !me.data) return <CenteredPage>{null}</CenteredPage>;
    return (
      <SiteShell user={me.data}>
        <div className="mx-auto w-full max-w-4xl px-7 pt-6 pb-10">
          <SettingsPage user={me.data} />
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell user={me.data ?? null}>
      <SkillsPanel role={me.data?.role ?? null} />
    </SiteShell>
  );
}

export default App;
