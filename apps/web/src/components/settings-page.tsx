import { roleMeets, type User } from "@skill-registry/shared";
import { ArrowLeftIcon } from "lucide-react";
import { ProfileCard } from "@/components/profile-card";
import { TokensCard } from "@/components/tokens-card";
import { Button } from "@/components/ui/button";
import { UsersCard } from "@/components/users-card";
import { useRouter } from "@/lib/use-router";
import { cn } from "@/lib/utils";

const PROFILE_PATH = "/settings";
const USERS_PATH = "/settings/users";
const TOKENS_PATH = "/settings/tokens";

type Section = "profile" | "users" | "tokens";

function sectionFor(pathname: string, canManageUsers: boolean): Section {
  if (pathname === USERS_PATH && canManageUsers) return "users";
  if (pathname === TOKENS_PATH) return "tokens";
  return "profile";
}

export function SettingsPage({ user, onBack }: { user: User; onBack: () => void }) {
  const { pathname, navigate } = useRouter();
  const canManageUsers = roleMeets(user.role, "admin");
  const section = sectionFor(pathname, canManageUsers);

  return (
    <div className="flex w-full max-w-4xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={onBack} aria-label="Back">
          <ArrowLeftIcon />
        </Button>
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
      </div>

      <nav className="flex gap-1 border-b">
        <SettingsTab label="Profile" active={section === "profile"} onClick={() => navigate(PROFILE_PATH)} />
        {canManageUsers && (
          <SettingsTab label="Users" active={section === "users"} onClick={() => navigate(USERS_PATH)} />
        )}
        <SettingsTab label="Tokens" active={section === "tokens"} onClick={() => navigate(TOKENS_PATH)} />
      </nav>

      {section === "profile" && <ProfileCard user={user} />}
      {section === "users" && canManageUsers && <UsersCard currentUserId={user.id} />}
      {section === "tokens" && <TokensCard />}
    </div>
  );
}

function SettingsTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active}
      className={cn(
        "px-3 py-2 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active
          ? "border-b-2 border-primary text-foreground"
          : "border-b-2 border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
