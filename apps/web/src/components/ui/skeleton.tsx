import { cn } from "@/lib/utils"

/**
 * A pulsing placeholder block for content that has not loaded yet. Give it a
 * width/height (or let it fill its parent) via `className`; it carries its own
 * rounded corners and `animate-pulse`.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-accent", className)}
      {...props}
    />
  )
}

export { Skeleton }
