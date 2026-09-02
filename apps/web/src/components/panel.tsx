import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A bordered content box with an optional uppercase header rule — the section
 * container the Skill detail page and its widgets are built from.
 *
 * @param title - The header label; when omitted (and no `action`), no header rule is drawn.
 * @param action - Right-aligned controls in the header, e.g. a tab switch.
 * @param contentClassName - Overrides the default body padding (e.g. `"p-0"` for a flush list).
 */
export function Panel({
  title,
  action,
  description,
  children,
  className,
  contentClassName,
}: {
  title?: ReactNode;
  action?: ReactNode;
  /** A muted paragraph shown just under the header rule, above the body. */
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-4 border-b px-5 py-2.5">
          {title && (
            <span className="text-xs tracking-[0.08em] text-muted-foreground uppercase">{title}</span>
          )}
          {action}
        </div>
      )}
      {description && <p className="border-b px-5 py-3 text-sm text-muted-foreground">{description}</p>}
      <div className={cn("p-5", contentClassName)}>{children}</div>
    </div>
  );
}
