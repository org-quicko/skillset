import type { ReactNode } from "react";
import { AuthenticatedHome } from "@/components/authenticated-home";
import { BootstrapForm } from "@/components/bootstrap-form";
import { LoginForm } from "@/components/login-form";
import { useCurrentUser, useSetupState } from "@/hooks/use-auth";

function App() {
  const setup = useSetupState();
  const initialized = setup.data?.initialized ?? false;
  const me = useCurrentUser(setup.isSuccess && initialized);

  let content: ReactNode = null;
  if (setup.isSuccess) {
    if (!initialized) {
      content = <BootstrapForm />;
    } else if (me.isSuccess) {
      content = me.data ? <AuthenticatedHome user={me.data} /> : <LoginForm />;
    }
  }

  return <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">{content}</div>;
}

export default App;
