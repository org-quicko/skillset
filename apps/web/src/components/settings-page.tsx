import { roleMeets, type User } from "@skill-registry/shared";
import { ConnectionCard } from "@/components/connection-card";
import { IdentityProvidersCard } from "@/components/identity-providers-card";
import { IntegrationsCard } from "@/components/integrations-card";
import { ProfileCard } from "@/components/profile-card";
import { TokensCard } from "@/components/tokens-card";
import { UsersCard } from "@/components/users-card";
import { useRouter } from "@/lib/use-router";
import { cn } from "@/lib/utils";

const PROFILE_PATH = "/settings";
const USERS_PATH = "/settings/users";
const TOKENS_PATH = "/settings/tokens";
const LOGIN_PATH = "/settings/login";
const INTEGRATIONS_PATH = "/settings/integrations";
const CONNECTIONS_PATH = "/settings/connections";

type Section = "profile" | "users" | "login" | "integrations" | "connections" | "tokens";

// `canManageUsers` gates the Login and Integrations sections too: both decide
// something about the Registry rather than about you — who may sign in, and
// which apps it holds repository credentials through — and the API refuses
// everyone below admin either way.
//
// Connections is gated on `writer` instead, and separately: it is the one
// section here that is about the person rather than the Registry, and a reader
// must not be invited to grant a credential they could never use (ADR-0024).
function sectionFor(pathname: string, canManageUsers: boolean, canImport: boolean): Section {
  if (pathname === USERS_PATH && canManageUsers) return "users";
  if (pathname === LOGIN_PATH && canManageUsers) return "login";
  if (pathname === INTEGRATIONS_PATH && canManageUsers) return "integrations";
  if (pathname === CONNECTIONS_PATH && canImport) return "connections";
  if (pathname === TOKENS_PATH) return "tokens";
  return "profile";
}

export function SettingsPage({ user }: { user: User }) {
  const { pathname, navigate } = useRouter();
  const canManageUsers = roleMeets(user.role, "admin");
  const canImport = roleMeets(user.role, "writer");
  const section = sectionFor(pathname, canManageUsers, canImport);

  const tabs: { label: string; section: Section; path: string }[] = [
    { label: "Personal Info", section: "profile", path: PROFILE_PATH },
    ...(canManageUsers ? [{ label: "Team", section: "users" as const, path: USERS_PATH }] : []),
    ...(canManageUsers ? [{ label: "OIDC", section: "login" as const, path: LOGIN_PATH }] : []),
    ...(canManageUsers
      ? [{ label: "Integrations", section: "integrations" as const, path: INTEGRATIONS_PATH }]
      : []),
    ...(canImport
      ? [{ label: "Connected Accounts", section: "connections" as const, path: CONNECTIONS_PATH }]
      : []),
    { label: "Tokens", section: "tokens", path: TOKENS_PATH },
  ];

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-3xl font-medium tracking-tight">Settings</h1>

      <nav className="flex gap-6 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.section}
            type="button"
            onClick={() => navigate(tab.path)}
            aria-current={section === tab.section}
            className={cn(
              "-mb-px cursor-pointer border-b-2 pb-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              section === tab.section
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="pt-1">
        <div
          key={section}
          className="fill-mode-both animate-in fade-in-0 slide-in-from-bottom-1 duration-200 [animation-timing-function:cubic-bezier(0.2,0,0,1)] motion-reduce:animate-none"
        >
          {section === "profile" && <ProfileCard user={user} />}
          {section === "users" && canManageUsers && <UsersCard currentUserId={user.id} />}
          {section === "login" && canManageUsers && <IdentityProvidersCard />}
          {section === "integrations" && canManageUsers && <IntegrationsCard />}
          {section === "connections" && canImport && <ConnectionCard />}
          {section === "tokens" && <TokensCard />}
        </div>
      </div>
    </div>
  );
}
