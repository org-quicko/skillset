import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * A one-shot fade-and-rise entrance, driven entirely by CSS (`tw-animate-css`)
 * so it is immune to React re-renders while data loads. Runs once when the
 * element mounts; give staggered siblings an increasing `delayMs`.
 *
 * @param delayMs - Delay before the entrance starts, in milliseconds.
 * @param className - Merged after the animation classes.
 * @example
 * ```tsx
 * <Reveal delayMs={80}>
 *   <h1>Title</h1>
 * </Reveal>
 * ```
 */
export function Reveal({
  delayMs = 0,
  className,
  style,
  ...props
}: ComponentProps<"div"> & { delayMs?: number }) {
  return (
    <div
      className={cn(
        "fill-mode-both animate-in fade-in-0 slide-in-from-bottom-2 duration-500 [animation-timing-function:cubic-bezier(0.2,0,0,1)] motion-reduce:animate-none",
        className,
      )}
      style={delayMs ? { animationDelay: `${delayMs}ms`, ...style } : style}
      {...props}
    />
  );
}
