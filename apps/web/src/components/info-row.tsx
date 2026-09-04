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
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        {description && <span className="text-sm text-muted-foreground">{description}</span>}
      </div>
      {children}
    </div>
  );
}
