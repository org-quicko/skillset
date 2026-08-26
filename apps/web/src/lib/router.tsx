import { useEffect, useState, type ReactNode } from "react";
import { RouterContext } from "@/lib/router-context";

export function RouterProvider({ children }: { children: ReactNode }) {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search));

  useEffect(() => {
    const onPopState = () => {
      setPathname(window.location.pathname);
      setSearch(new URLSearchParams(window.location.search));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // `path` may carry its own query string (e.g. "/?sort_by=updated_at") —
  // parsed back out so `search` stays in sync without a second round-trip
  // through the browser's own location.
  function navigate(path: string) {
    window.history.pushState(null, "", path);
    const url = new URL(path, window.location.origin);
    setPathname(url.pathname);
    setSearch(url.searchParams);
  }

  function replace(path: string) {
    window.history.replaceState(null, "", path);
    const url = new URL(path, window.location.origin);
    setPathname(url.pathname);
    setSearch(url.searchParams);
  }

  return <RouterContext.Provider value={{ pathname, search, navigate, replace }}>{children}</RouterContext.Provider>;
}
