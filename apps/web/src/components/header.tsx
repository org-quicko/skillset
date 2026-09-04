import type { User } from "@skill-registry/shared";
import { ChevronDownIcon, LogOutIcon, SettingsIcon } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
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
 * The site's top navigation: the wordmark, the theme toggle, and either a
 * Sign in link or the signed-in User's menu.
 *
 * @param user - The signed-in User, or `null`/`undefined` for a signed-out visitor.
 * @param onOpenSettings - Called when the User picks Settings from their menu.
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
          className="cursor-pointer font-wordmark text-[13px] tracking-[0.04em] lowercase outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          skillset
        </button>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="flex cursor-pointer items-center gap-2 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <Avatar className="size-[26px]">
                  <AvatarFallback className="text-[11px]">{initials(user)}</AvatarFallback>
                </Avatar>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {user.first_name} {user.last_name}
                </span>
                <ChevronDownIcon strokeWidth={1.5} className="size-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
                    <span className="text-sm font-medium text-foreground">
                      {user.first_name} {user.last_name}
                    </span>
                    <span className="text-xs text-muted-foreground">{user.email}</span>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onOpenSettings}>
                  <SettingsIcon />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => logout.mutate()} disabled={logout.isPending}>
                  <LogOutIcon />
                  {logout.isPending ? "Signing out…" : "Sign out"}
                </DropdownMenuItem>
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
