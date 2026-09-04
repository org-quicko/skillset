import { cn } from "@/lib/utils"

/**
 * An indeterminate loading spinner. Inherits its colour from `currentColor`
 * and its size from `className` (defaults to `size-5`).
 */
function Spinner({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn(
        "size-5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60 motion-reduce:animate-none",
        className
      )}
      {...props}
    />
  )
}

export { Spinner }
