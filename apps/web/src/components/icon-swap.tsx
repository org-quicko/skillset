import { cn } from "@/lib/utils";

/**
 * Crossfades between two icon states that occupy the same spot — a copy button
 * flipping to a check, for instance. Both icons stay mounted, stacked in one
 * grid cell; only the active one is opaque. Pure CSS, so it never stalls.
 *
 * @param showAlt - When true, the `alt` icon is shown; otherwise `base`.
 * @param base - The default icon.
 * @param alt - The icon shown while `showAlt` is true.
 * @param className - Passed to the wrapping element.
 * @example
 * ```tsx
 * <IconSwap
 *   showAlt={copied}
 *   base={<CopyIcon className="size-4" />}
 *   alt={<CheckIcon className="size-4" />}
 * />
 * ```
 */
export function IconSwap({
  showAlt,
  base,
  alt,
  className,
}: {
  showAlt: boolean;
  base: React.ReactNode;
  alt: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-grid place-items-center", className)}>
      <span
        className={cn(
          "col-start-1 row-start-1 inline-flex transition-[opacity,scale,filter] duration-200 [transition-timing-function:cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
          showAlt ? "scale-100 opacity-100 blur-0" : "scale-[0.25] opacity-0 blur-[4px]",
        )}
      >
        {alt}
      </span>
      <span
        className={cn(
          "col-start-1 row-start-1 inline-flex transition-[opacity,scale,filter] duration-200 [transition-timing-function:cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
          showAlt ? "scale-[0.25] opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-0",
        )}
      >
        {base}
      </span>
    </span>
  );
}
