import type { ReactNode } from "react";
import { AuthenticatedHome } from "@/components/authenticated-home";
import { BootstrapForm } from "@/components/bootstrap-form";
import { Header } from "@/components/header";
import { LoginForm } from "@/components/login-form";
import { SettingsPage } from "@/components/settings-page";
import { useCurrentUser, useSetupState } from "@/hooks/use-auth";
import { useRouter } from "@/lib/router";

function App() {
  const setup = useSetupState();
  const initialized = setup.data?.initialized ?? false;
  const me = useCurrentUser(setup.isSuccess && initialized);
  const { pathname, navigate } = useRouter();

  if (setup.isSuccess && initialized && me.isSuccess && me.data) {
    return (
      <div className="flex min-h-svh flex-col">
        <Header user={me.data} onOpenSettings={() => navigate("/settings")} />
        <main className="flex flex-1 justify-center p-4 sm:p-6">
          {pathname === "/settings" ? (
            <SettingsPage onBack={() => navigate("/")} />
          ) : (
            <AuthenticatedHome user={me.data} />
          )}
        </main>
      </div>
    );
  }

  let content: ReactNode = null;
  if (setup.isSuccess) {
    if (!initialized) {
      content = <BootstrapForm />;
    } else if (me.isSuccess) {
      content = <LoginForm />;
    }
  }

  return <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">{content}</div>;
}

export default App;
