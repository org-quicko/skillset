import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light" | "system";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

/**
 * Applies `light`/`dark` (or the OS preference, for `system`) to
 * `document.documentElement` as a class, which Tailwind's `dark:` variant
 * reads, and persists the chosen theme to `localStorage` so it survives a
 * reload.
 *
 * @param children - Subtree that can call {@link useTheme}.
 * @param defaultTheme - Theme used before anything is stored. Defaults to `"system"`.
 * @param storageKey - `localStorage` key the theme is persisted under. Defaults to `"theme"`.
 *
 * @example
 * ```tsx
 * <ThemeProvider>
 *   <App />
 * </ThemeProvider>
 * ```
 */
export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme | null) ?? defaultTheme,
  );

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setTheme(theme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

/**
 * Reads the current theme and a setter for it.
 *
 * @throws {Error} If called outside a {@link ThemeProvider}.
 *
 * @example
 * ```tsx
 * const { theme, setTheme } = useTheme();
 * ```
 */
export function useTheme(): ThemeProviderState {
  const context = useContext(ThemeProviderContext);

  if (context === undefined) throw new Error("useTheme must be used within a ThemeProvider");

  return context;
}
