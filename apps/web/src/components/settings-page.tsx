import { roleMeets, type User } from "@in-org-quicko/skillset-shared";
import { ArrowLeftIcon } from "lucide-react";
import { AiAssistantsCard } from "@/components/ai-assistants-card";
import { ConnectionCard } from "@/components/connection-card";
import { IdentityProvidersCard } from "@/components/identity-providers-card";
import { IntegrationsCard } from "@/components/integrations-card";
import { ProfileCard } from "@/components/profile-card";
import { Button } from "@/components/ui/button";
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
const ASSISTANTS_PATH = "/settings/ai-assistants";

type Section = "profile" | "users" | "login" | "integrations" | "connections" | "tokens" | "assistants";

// `canManageUsers` gates the Integrations section too: it decides something
// about the Registry rather than about you — which apps it holds repository
// credentials through — and the API refuses everyone below admin either way.
//
// OIDC is `superadmin`, matching the API (ISSUE-2). Configuring a Provider
// decides who can obtain an account here and, for an ungated one, who an
// external login may attach to, which made it the shortest path from a
// compromised Admin account to the Superadmin's.
//
// Connections is gated on `writer` instead, and separately: it is the one
// section here that is about the person rather than the Registry, and a reader
// must not be invited to grant a credential they could never use (ADR-0024).
function sectionFor(
  pathname: string,
  canManageUsers: boolean,
  canManageLogin: boolean,
  canImport: boolean,
): Section {
  if (pathname === USERS_PATH && canManageUsers) return "users";
  if (pathname === LOGIN_PATH && canManageLogin) return "login";
  if (pathname === INTEGRATIONS_PATH && canManageUsers) return "integrations";
  if (pathname === CONNECTIONS_PATH && canImport) return "connections";
  if (pathname === TOKENS_PATH) return "tokens";
  if (pathname === ASSISTANTS_PATH) return "assistants";
  return "profile";
}

export function SettingsPage({ user }: { user: User }) {
  const { pathname, navigate } = useRouter();
  const canManageUsers = roleMeets(user.role, "admin");
  const canManageLogin = roleMeets(user.role, "superadmin");
  const canImport = roleMeets(user.role, "writer");
  const section = sectionFor(pathname, canManageUsers, canManageLogin, canImport);

  const tabs: { label: string; section: Section; path: string }[] = [
    { label: "Personal Info", section: "profile", path: PROFILE_PATH },
    ...(canManageUsers ? [{ label: "Team", section: "users" as const, path: USERS_PATH }] : []),
    ...(canManageLogin ? [{ label: "OIDC", section: "login" as const, path: LOGIN_PATH }] : []),
    ...(canManageUsers
      ? [{ label: "Integrations", section: "integrations" as const, path: INTEGRATIONS_PATH }]
      : []),
    ...(canImport
      ? [{ label: "Connected Accounts", section: "connections" as const, path: CONNECTIONS_PATH }]
      : []),
    { label: "Tokens", section: "tokens", path: TOKENS_PATH },
    { label: "AI Assistants", section: "assistants", path: ASSISTANTS_PATH },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        {/* `-ml-1` cancels the icon-sm button's own centering inset (the button box
            is wider than the icon inside it), so the arrow glyph itself starts flush
            with the page's left padding — lined up with the header wordmark's "S". */}
        <Button
          variant="ghost"
          size="icon-sm"
          className="-ml-1"
          aria-label="Back to skills"
          onClick={() => navigate("/")}
        >
          <ArrowLeftIcon className="size-5" />
        </Button>
        <h1 className="text-3xl font-medium tracking-tight">Settings</h1>
      </div>

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
          {section === "login" && canManageLogin && <IdentityProvidersCard />}
          {section === "integrations" && canManageUsers && <IntegrationsCard />}
          {section === "connections" && canImport && <ConnectionCard />}
          {section === "tokens" && <TokensCard />}
          {section === "assistants" && <AiAssistantsCard />}
        </div>
      </SidebarProvider>
    </div>
  );
}
