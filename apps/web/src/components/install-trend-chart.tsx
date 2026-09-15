import type { SkillInstallTrendPoint } from "@in-org-quicko/sqillset-shared";
import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const CHART_WIDTH = 300;
const CHART_HEIGHT = 48;
const PLOT_LEFT = 6;
const PLOT_RIGHT = CHART_WIDTH - 6;
const PLOT_TOP = 6;
const PLOT_BOTTOM = CHART_HEIGHT - 6;
const DOT_RADIUS = 3;

const dayLabelFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** Parses a `YYYY-MM-DD` point date as a local calendar date, not UTC midnight — avoids `new Date("2026-09-07")` displaying as the previous day west of UTC. */
function parseLocalDate(date: string): Date {
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * The Installs panel's trend chart: one line, one point per day, oldest
 * first, height proportional to that day's count, with a light area wash
 * underneath. The line and wash sit in the de-emphasis tone throughout;
 * only the endpoint — today — carries the accent, matching the stat-tile
 * trend's `current period in the accent` contract for a single series, so
 * no legend is needed. A zero-Install day still sits on the baseline rather
 * than creating a gap.
 *
 * @remarks
 * A single continuous hover/focus surface, not a per-point hit target: a
 * pointer anywhere over the plot snaps to the nearest day (the crosshair
 * pattern `interaction.md` calls for on line charts), drawing a hairline at
 * that day and lifting its point into the accent style with a tooltip.
 * Arrow-key navigation gives keyboard focus the same detail.
 *
 * @param points - One point per day, oldest first — `useSkillInstallTrend`'s shape.
 * @example
 * ```tsx
 * <InstallTrendChart points={trend.data.points} />
 * ```
 */
export function InstallTrendChart({ points }: { points: SkillInstallTrendPoint[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipLeft, setTooltipLeft] = useState(0);

  const lastIndex = points.length - 1;
  const maxCount = Math.max(1, ...points.map((point) => point.count));

  const xAt = (index: number) => (lastIndex === 0 ? PLOT_LEFT : PLOT_LEFT + (index / lastIndex) * (PLOT_RIGHT - PLOT_LEFT));
  const yAt = (count: number) => PLOT_BOTTOM - ((PLOT_BOTTOM - PLOT_TOP) * count) / maxCount;

  const coords = points.map((point, index) => ({ x: xAt(index), y: yAt(point.count) }));
  const hoveredCoord = hoveredIndex !== null ? coords[hoveredIndex] : undefined;

  // Keeps the tooltip inside the chart's own bounds instead of centering it
  // on the hovered point unconditionally — near the left/right edges a
  // centered tooltip overhangs the panel, which clips it (Panel is
  // `overflow-hidden` for its rounded corners). Runs unconditionally (ahead
  // of the `points.length === 0` early return below) to keep this hook's
  // call count stable across renders.
  useLayoutEffect(() => {
    if (!hoveredCoord || !containerRef.current || !tooltipRef.current) return;
    const containerWidth = containerRef.current.clientWidth;
    const half = tooltipRef.current.offsetWidth / 2;
    const desired = (hoveredCoord.x / CHART_WIDTH) * containerWidth;
    setTooltipLeft(Math.min(Math.max(desired, half), containerWidth - half));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depend on the coordinate's primitives, not the recreated-per-render `coords` object
  }, [hoveredCoord?.x]);

  if (points.length === 0) return null;

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ");
  const areaPath = `${linePath} L${coords[lastIndex]!.x},${PLOT_BOTTOM} L${coords[0]!.x},${PLOT_BOTTOM} Z`;

  const hovered = hoveredIndex !== null ? points[hoveredIndex] : undefined;

  function indexFromClientX(svg: SVGSVGElement, clientX: number): number {
    const rect = svg.getBoundingClientRect();
    const fraction = rect.width === 0 ? 0 : (clientX - rect.left) / rect.width;
    const localX = fraction * CHART_WIDTH;
    const ratio = (localX - PLOT_LEFT) / (PLOT_RIGHT - PLOT_LEFT);
    return Math.min(lastIndex, Math.max(0, Math.round(ratio * lastIndex)));
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    setHoveredIndex(indexFromClientX(event.currentTarget, event.clientX));
  }

  return (
    <div ref={containerRef} className="relative">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        className="h-11 w-full overflow-visible outline-none"
        tabIndex={0}
        role="img"
        aria-label={`Daily installs for the last ${points.length} days, ending today at ${points[lastIndex]!.count}`}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoveredIndex(null)}
        onFocus={() => setHoveredIndex((current) => current ?? lastIndex)}
        onBlur={() => setHoveredIndex(null)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            setHoveredIndex((current) => Math.max(0, (current ?? lastIndex) - 1));
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            setHoveredIndex((current) => Math.min(lastIndex, (current ?? lastIndex) + 1));
          }
        }}
      >
        <path d={areaPath} className="fill-muted-foreground/10" />
        <path
          d={linePath}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="stroke-muted-foreground/60"
        />
        {hoveredCoord && (
          <line
            x1={hoveredCoord.x}
            x2={hoveredCoord.x}
            y1={PLOT_TOP}
            y2={PLOT_BOTTOM}
            strokeWidth={1}
            className="stroke-border"
          />
        )}
        {/* Today's point always carries the accent; a hovered earlier point borrows the same style while inspected. */}
        <circle
          cx={coords[lastIndex]!.x}
          cy={coords[lastIndex]!.y}
          r={DOT_RADIUS}
          strokeWidth={2}
          className="fill-foreground stroke-card"
        />
        {hoveredCoord && hoveredIndex !== lastIndex && (
          <circle cx={hoveredCoord.x} cy={hoveredCoord.y} r={DOT_RADIUS} strokeWidth={2} className="fill-foreground stroke-card" />
        )}
      </svg>
      {hovered && hoveredCoord && (
        <div
          ref={tooltipRef}
          className="pointer-events-none absolute bottom-full mb-1.5 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs whitespace-nowrap text-background shadow-md"
          style={{ left: `${tooltipLeft}px` }}
        >
          <span className="font-medium tabular-nums">{hovered.count}</span>{" "}
          {hovered.count === 1 ? "install" : "installs"} · {dayLabelFormatter.format(parseLocalDate(hovered.date))}
        </div>
      )}
    </div>
  );
}
