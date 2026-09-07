import type { User } from "@skill-registry/shared";
import { LogOutIcon, SettingsIcon } from "lucide-react";
import { ThemeSegmentedControl, ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
import { LOGIN_PATH } from "@/lib/routes";
import { useRouter } from "@/lib/use-router";

function initials(user: User): string {
  return `${user.first_name[0]}${user.last_name[0]}`.toUpperCase();
}

/**
 * The site's top navigation: the wordmark, and either a Sign in link (with a
 * standalone theme toggle) or the signed-in User's menu, which folds the
 * theme control into itself.
 *
 * @param user - The signed-in User, or `null`/`undefined` for a signed-out visitor.
 * @param onOpenSettings - Called when the User picks Edit personal info or Settings from their menu.
 */
export function Header({ user, onOpenSettings }: { user?: User | null; onOpenSettings?: () => void }) {
  const logout = useLogout();
  const { navigate } = useRouter();

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

        <div className="flex items-center gap-3">
          {!user && <ThemeToggle />}
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="flex cursor-pointer items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <Avatar className="size-[26px]">
                  <AvatarFallback className="text-[11px]">{initials(user)}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
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
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full rounded-full"
                      onClick={onOpenSettings}
                    >
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
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => navigate(LOGIN_PATH)}
            >
              Sign in
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
