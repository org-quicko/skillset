import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** A moment in the shape every page shows it: the viewer's own locale and timezone. */
export function formatMoment(value: string | null): string {
  if (value === null) return "never"
  return new Date(value).toLocaleString()
}

/** Just the calendar date — "13 Mar 2026" in the viewer's locale — for the Skill detail Details panel. */
export function formatDate(value: string | null): string {
  if (value === null) return "never"
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

const RELATIVE_UNITS: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: "year", seconds: 31_536_000 },
  { unit: "month", seconds: 2_592_000 },
  { unit: "week", seconds: 604_800 },
  { unit: "day", seconds: 86_400 },
  { unit: "hour", seconds: 3_600 },
  { unit: "minute", seconds: 60 },
]

/**
 * A moment as a short "3d ago" style string, in the viewer's locale — what the
 * Skill list's Updated column shows. Falls back to "just now" under a minute
 * and "never" for a null value.
 */
export function formatRelativeTime(value: string | null): string {
  if (value === null) return "never"
  const deltaSeconds = (Date.now() - new Date(value).getTime()) / 1000
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" })
  for (const { unit, seconds } of RELATIVE_UNITS) {
    if (deltaSeconds >= seconds) return formatter.format(-Math.floor(deltaSeconds / seconds), unit)
  }
  return "just now"
}
