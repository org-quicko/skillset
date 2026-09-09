import { roleMeets, type User } from "@skillset/shared";
import { ConnectionCard } from "@/components/connection-card";
import { IdentityProvidersCard } from "@/components/identity-providers-card";
import { IntegrationsCard } from "@/components/integrations-card";
import { ProfileCard } from "@/components/profile-card";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { TokensCard } from "@/components/tokens-card";
import { UsersCard } from "@/components/users-card";
import { useRouter } from "@/lib/use-router";

const PROFILE_PATH = "/settings";
const USERS_PATH = "/settings/users";
const TOKENS_PATH = "/settings/tokens";
const LOGIN_PATH = "/settings/login";
const INTEGRATIONS_PATH = "/settings/integrations";
const CONNECTIONS_PATH = "/settings/connected-accounts";

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

      <SidebarProvider className="min-h-0 items-start gap-8">
        <Sidebar collapsible="none" className="w-48 shrink-0 bg-transparent">
          <SidebarContent>
            <SidebarGroup className="p-0">
              <SidebarGroupContent>
                <SidebarMenu>
                  {tabs.map((tab) => (
                    <SidebarMenuItem key={tab.section}>
                      <SidebarMenuButton
                        isActive={section === tab.section}
                        onClick={() => navigate(tab.path)}
                      >
                        {tab.label}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>

        <div
          key={section}
          className="min-w-0 flex-1 fill-mode-both animate-in fade-in-0 slide-in-from-bottom-1 duration-200 [animation-timing-function:cubic-bezier(0.2,0,0,1)] motion-reduce:animate-none"
        >
          {section === "profile" && <ProfileCard user={user} />}
          {section === "users" && canManageUsers && <UsersCard currentUserId={user.id} />}
          {section === "login" && canManageUsers && <IdentityProvidersCard />}
          {section === "integrations" && canManageUsers && <IntegrationsCard />}
          {section === "connections" && canImport && <ConnectionCard />}
          {section === "tokens" && <TokensCard />}
        </div>
      </SidebarProvider>
    </div>
  );
}
