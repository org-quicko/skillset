import type { ReactNode } from "react";

/** One row of a Settings tile: a label (and optional description) on the left, its value or control on the right. */
export function InfoRow({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        {description && <span className="text-sm text-muted-foreground">{description}</span>}
      </div>
      {children}
    </div>
  );
}
