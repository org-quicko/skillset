import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/components/theme-provider";

/**
 * Icon button that flips between the light and dark theme.
 *
 * @remarks
 * Always lands on `"light"` or `"dark"`, never `"system"` — once the reader
 * chooses explicitly, the toggle stops guessing at the OS preference.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Toggle theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          <SunIcon className="scale-100 dark:scale-0" />
          <MoonIcon className="absolute scale-0 dark:scale-100" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Toggle theme</TooltipContent>
    </Tooltip>
  );
}
