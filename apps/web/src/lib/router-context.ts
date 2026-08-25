import { createContext } from "react";

export interface RouterContextValue {
  pathname: string;
  navigate: (path: string) => void;
}

export const RouterContext = createContext<RouterContextValue | null>(null);
