import { useEffect, useState, type ReactNode } from "react";
import { RouterContext } from "@/lib/router-context";

export function RouterProvider({ children }: { children: ReactNode }) {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigate(path: string) {
    window.history.pushState(null, "", path);
    setPathname(path);
  }

  function replace(path: string) {
    window.history.replaceState(null, "", path);
    setPathname(path);
  }

  return <RouterContext.Provider value={{ pathname, navigate, replace }}>{children}</RouterContext.Provider>;
}
