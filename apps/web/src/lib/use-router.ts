import { useContext } from "react";
import { RouterContext } from "@/lib/router-context";

export function useRouter() {
  const context = useContext(RouterContext);
  if (!context) throw new Error("useRouter must be used within a RouterProvider");
  return context;
}
