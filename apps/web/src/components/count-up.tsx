import { useEffect, useRef, useState } from "react";

/**
 * A number that eases from its previous value to `value` whenever `value`
 * changes, rendered with the viewer's locale grouping. Snaps instantly when
 * the viewer prefers reduced motion.
 *
 * @param value - The target number to display.
 * @param className - Passed to the wrapping `<span>`.
 * @param durationMs - Tween length in milliseconds. Defaults to 700.
 * @example
 * ```tsx
 * <CountUp value={stats.installs} className="text-2xl font-medium tabular-nums" />
 * ```
 */
export function CountUp({
  value,
  className,
  durationMs = 700,
}: {
  value: number;
  className?: string;
  durationMs?: number;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const from = fromRef.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || from === value) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameRef.current);
      fromRef.current = value;
    };
  }, [value, durationMs]);

  return <span className={className}>{display.toLocaleString()}</span>;
}
