import { useEffect, type ReactNode } from "react";
import { AuthenticatedHome } from "@/components/authenticated-home";
import { BootstrapForm } from "@/components/bootstrap-form";
import { ChangePasswordRequired } from "@/components/change-password-required";
import { Header } from "@/components/header";
import { LoginForm } from "@/components/login-form";
import { SettingsPage } from "@/components/settings-page";
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

function App() {
  const setup = useSetupState();
  const initialized = setup.data?.initialized ?? false;
  const me = useCurrentUser(setup.isSuccess && initialized);
  const { pathname, navigate, replace } = useRouter();

  const isSignedOut = setup.isSuccess && initialized && me.isSuccess && !me.data;
  const isSignedIn = setup.isSuccess && initialized && me.isSuccess && !!me.data;

  // /login is a real, addressable route, not just whatever renders when
  // nothing else matches: a signed-out visitor anywhere else is bounced
  // there, and a signed-in one who lands on it (e.g. the back button after
  // logging in) is bounced home. `replace`, not `navigate` — this is a
  // correction, not a transition the back button should have to undo.
  useEffect(() => {
    if (isSignedOut && pathname !== LOGIN_PATH) replace(LOGIN_PATH);
    else if (isSignedIn && pathname === LOGIN_PATH) replace("/");
  }, [isSignedOut, isSignedIn, pathname, replace]);

  if (isSignedIn && me.data) {
    // A generated password that hasn't been replaced yet blocks every other
    // route (docs/data-model.md) — there is nothing else to offer until it is.
    if (me.data.must_change_password) {
      return (
        <CenteredPage>
          <ChangePasswordRequired />
        </CenteredPage>
      );
    }

    return (
      <div className="flex min-h-svh flex-col">
        <Header user={me.data} onOpenSettings={() => navigate("/settings")} />
        <main className="flex flex-1 justify-center p-4 sm:p-6">
          {isSettingsPath(pathname) ? (
            <SettingsPage user={me.data} onBack={() => navigate("/")} />
          ) : (
            <AuthenticatedHome user={me.data} />
          )}
        </main>
      </div>
    );
  }

  if (setup.isSuccess && !initialized) {
    return (
      <CenteredPage>
        <BootstrapForm />
      </CenteredPage>
    );
  }

  if (pathname === LOGIN_PATH) {
    return (
      <CenteredPage>
        <LoginForm />
      </CenteredPage>
    );
  }

  return <CenteredPage>{null}</CenteredPage>;
}

export default App;
