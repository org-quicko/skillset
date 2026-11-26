import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The text tabs a {@link Panel} header carries, such as the clients on an MCP
 * server's Configuration panel.
 *
 * @remarks
 * Labels never wrap mid-label, and the strip wraps onto a second line rather
 * than overflowing the panel on a narrow screen.
 *
 * @param tabs - Each tab's id and label, in order.
 * @param value - The selected tab's id.
 * @param onChange - Called with a tab's id when it is picked.
 * @example
 * ```tsx
 * <PanelTabs tabs={[{ id: "a", label: "A" }]} value="a" onChange={setTab} />
 * ```
 */
export function PanelTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly { id: T; label: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="flex min-w-0 flex-wrap gap-x-3.5 gap-y-1 text-xs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          onClick={() => onChange(tab.id)}
          className={cn(
            "cursor-pointer rounded-sm whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            tab.id === value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
