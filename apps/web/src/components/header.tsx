import type { User } from "@in-org-quicko/skillset-shared";
import { LogOutIcon, SettingsIcon } from "lucide-react";
import type { ReactNode } from "react";
import { WordmarkButton } from "@/components/logo";
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
import { SECTION_LIST, sectionForPath, type SectionKind } from "@/lib/sections";
import { useRouter } from "@/lib/use-router";
import { cn, userDisplayName, userInitials } from "@/lib/utils";

/** The parts of a nav icon that move when its link is hovered. */
const SHIFT = "transition-[translate,opacity] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)]";

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 overflow-visible"
    >
      {children}
    </svg>
  );
}

/** Stacked cards: the front two slide down-left on hover. */
function SkillsIcon() {
  return (
    <NavIcon>
      <g className={cn(SHIFT, "group-hover:translate-x-[-4px] group-hover:translate-y-[4px]")}>
        <path d="M21 7h-3a2 2 0 0 1-2-2V2" />
        <path d="M21 6v6.5c0 .8-.7 1.5-1.5 1.5h-7c-.8 0-1.5-.7-1.5-1.5v-9c0-.8.7-1.5 1.5-1.5H17Z" />
      </g>
      <path
        d="M7 8v8.8c0 .3.2.6.4.8.2.2.5.4.8.4H15"
        className={cn(SHIFT, "group-hover:translate-x-[-2px] group-hover:translate-y-[2px]")}
      />
      <path d="M3 12v8.8c0 .3.2.6.4.8.2.2.5.4.8.4H11" />
    </NavIcon>
  );
}

/** A block that slots into its frame on hover. */
function McpIcon() {
  return (
    <NavIcon>
      <rect
        x="14"
        y="3"
        width="7"
        height="7"
        rx="1"
        className={cn(SHIFT, "group-hover:translate-x-[-4px] group-hover:translate-y-[4px]")}
      />
      <path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3" />
    </NavIcon>
  );
}

/** A plug and socket that join on hover, hiding the pins. */
function PluginsIcon() {
  return (
    <NavIcon>
      <g className={cn(SHIFT, "group-hover:translate-x-[3px] group-hover:translate-y-[-3px]")}>
        <path d="m2 22 3-3" />
        <path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
        <path d="M7.5 13.5 10 11" className="transition-opacity duration-[240ms] group-hover:opacity-0" />
        <path d="M10.5 16.5 13 14" className="transition-opacity duration-[240ms] group-hover:opacity-0" />
      </g>
      <g className={cn(SHIFT, "group-hover:translate-x-[-3px] group-hover:translate-y-[3px]")}>
        <path d="m19 5 3-3" />
        <path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z" />
      </g>
    </NavIcon>
  );
}

const SECTION_ICONS: Record<SectionKind, () => ReactNode> = {
  skill: SkillsIcon,
  mcp: McpIcon,
  plugin: PluginsIcon,
};

/**
 * The site's top navigation: the wordmark, the Skills / MCP / Plugins section links, a
 * Sign in link and standalone theme toggle for signed-out visitors, and the signed-in
 * User's menu, which folds the theme control into itself. Publishing lives in each
 * section's hero, not here.
 *
 * @param user - The signed-in User, or `null`/`undefined` for a signed-out visitor.
 * @param onOpenSettings - Called when the User picks Edit personal info or Settings from their menu.
 */
export function Header({ user, onOpenSettings }: { user?: User | null; onOpenSettings?: () => void }) {
  const logout = useLogout();
  const { pathname, navigate } = useRouter();
  // Settings is no section, so no link is marked current there.
  const current = pathname.startsWith("/settings") ? null : sectionForPath(pathname);

  return (
    <header className="w-full border-b bg-background">
      <div className="relative mx-auto flex h-[54px] w-full max-w-[1200px] items-center justify-between px-7">
        <WordmarkButton />

        {/* Centred on the bar, not between its neighbours, as the Top Nav design has it. */}
        <nav className="absolute left-1/2 flex -translate-x-1/2 items-center gap-[22px]">
          {SECTION_LIST.map((section) => {
            const active = current?.kind === section.kind;
            const Icon = SECTION_ICONS[section.kind];
            return (
              <a
                key={section.kind}
                href={section.path}
                aria-current={active ? "page" : undefined}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  navigate(section.path);
                }}
                className={cn(
                  "group flex h-8 items-center gap-[7px] rounded-full px-3 text-sm leading-4 font-medium whitespace-nowrap transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon />
                {section.title}
              </a>
            );
          })}
        </nav>

        <div className="flex items-center gap-4">
          {!user && (
            <Button variant="outline" onClick={() => navigate(LOGIN_PATH)}>
              Sign in
            </Button>
          )}
          {!user && <ThemeToggle />}
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="flex cursor-pointer items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <Avatar className="size-[26px]">
                  <AvatarFallback className="text-[11px]">{userInitials(user)}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={14} className="w-64">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="flex flex-col items-center gap-3 px-3 pt-3 pb-4 text-center font-normal">
                    <Avatar className="size-12">
                      <AvatarFallback className="text-base">{userInitials(user)}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-foreground">
                        {userDisplayName(user)}
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
          ) : null}
        </div>
      </div>
    </header>
  );
}
