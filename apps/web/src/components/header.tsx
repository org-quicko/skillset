import { roleMeets, type User } from "@in-org-quicko/skillset-shared";
import { LogOutIcon, SettingsIcon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { PublishSkillForm } from "@/components/publish-skill-form";
import { ThemeSegmentedControl, ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FormDialog, FormDialogBody, FormDialogHeader } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLogout } from "@/hooks/use-auth";
import { LOGIN_PATH, skillPath } from "@/lib/routes";
import { useRouter } from "@/lib/use-router";

function initials(user: User): string {
  return `${user.first_name[0]}${user.last_name[0]}`.toUpperCase();
}

/**
 * The site's top navigation: the wordmark, the Publish a skill action (shown to every
 * visitor able to publish, signed in or not), a standalone theme toggle for signed-out
 * visitors, and the signed-in User's menu, which folds the theme control into itself.
 *
 * @param user - The signed-in User, or `null`/`undefined` for a signed-out visitor.
 * @param onOpenSettings - Called when the User picks Edit personal info or Settings from their menu.
 */
export function Header({ user, onOpenSettings }: { user?: User | null; onOpenSettings?: () => void }) {
  const logout = useLogout();
  const { navigate } = useRouter();
  const [publishOpen, setPublishOpen] = useState(false);

  // Shown to every visitor, signed out or not: clicking it while signed out asks for a
  // login instead of hiding the option outright (reads never require a session, but
  // publishing does).
  const canPublish = !user || roleMeets(user.role, "writer");

  return (
    <header className="w-full border-b bg-background">
      <div className="relative mx-auto flex h-[54px] w-full max-w-[1200px] items-center justify-between px-7">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="cursor-pointer font-wordmark text-2xl tracking-[0.04em] uppercase outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          SKILLSET
        </button>

        <div className="flex items-center gap-4">
          {canPublish && (
            <Button variant="outline" onClick={() => (user ? setPublishOpen(true) : navigate(LOGIN_PATH))}>
              <UploadIcon />
              Publish<span className="hidden sm:inline"> a Skill</span>
            </Button>
          )}
          {!user && <ThemeToggle />}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger className="flex cursor-pointer items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <Avatar className="size-[26px]">
                  <AvatarFallback className="text-[11px]">{initials(user)}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={14} className="w-64">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="flex flex-col items-center gap-3 px-3 pt-3 pb-4 text-center font-normal">
                    <Avatar className="size-12">
                      <AvatarFallback className="text-base">{initials(user)}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-foreground">
                        {user.first_name} {user.last_name}
                      </span>
                      <span className="text-xs text-muted-foreground">{user.email}</span>
                    </div>
                    <Button variant="outline" className="w-full" onClick={onOpenSettings}>
                      Edit personal info
                    </Button>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuItem onClick={onOpenSettings} className="py-1.5">
                  <SettingsIcon />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <div className="flex items-center justify-between px-1.5 py-1">
                  <ThemeSegmentedControl />
                  <DropdownMenuItem onClick={() => logout.mutate()} disabled={logout.isPending}>
                    <LogOutIcon />
                    {logout.isPending ? "Signing out…" : "Sign out"}
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button size="sm" onClick={() => navigate(LOGIN_PATH)}>
              Sign in
            </Button>
          )}
        </div>
      </div>

      <FormDialog open={publishOpen} onOpenChange={setPublishOpen} className="max-h-[648px] w-full max-w-2xl sm:max-w-2xl">
        <FormDialogHeader
          title="Publish a skill"
          description="Upload a Skill's folder or SKILL.md, or import it from GitHub."
        />
        <FormDialogBody>
          <PublishSkillForm
            onPublished={(name) => {
              setPublishOpen(false);
              navigate(skillPath(name));
            }}
          />
        </FormDialogBody>
      </FormDialog>
    </header>
  );
}
