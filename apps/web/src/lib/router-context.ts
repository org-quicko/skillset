import { createContext } from "react";

export interface RouterContextValue {
  pathname: string;
  /** Pushes a new history entry — for a deliberate transition the back button should be able to undo. */
  navigate: (path: string) => void;
  /** Swaps the current history entry in place — for an automatic redirect (e.g. bouncing a logged-out visitor to /login) that shouldn't itself become a back-button stop. */
  replace: (path: string) => void;
}

export const RouterContext = createContext<RouterContextValue | null>(null);
