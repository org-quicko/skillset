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

/** Sentence-cases a string by upper-casing its first character alone, leaving the rest — including any other capitals — untouched. */
function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * A moment as a short "3d ago" style string, in the viewer's locale — what the
 * Skill list's Updated column shows. Falls back to "Just now" under a minute
 * and "Never" for a null value.
 */
export function formatRelativeTime(value: string | null): string {
  if (value === null) return "Never"
  const deltaSeconds = (Date.now() - new Date(value).getTime()) / 1000
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" })
  for (const { unit, seconds } of RELATIVE_UNITS) {
    if (deltaSeconds >= seconds) return sentenceCase(formatter.format(-Math.floor(deltaSeconds / seconds), unit))
  }
  return "Just now"
}

const BYTE_UNITS = ["B", "KB", "MB"]

/** A file size in the shape a file browser shows it — "812 B", "4.1 KB", "1.2 MB". */
export function formatBytes(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  // Whole bytes read oddly with a decimal place; anything scaled reads oddly without one.
  return `${unit === 0 ? value : value.toFixed(1)} ${BYTE_UNITS[unit]}`
}

/**
 * Splits a Skill's `allowed-tools` frontmatter into the tool names it lists.
 *
 * @param value - The raw frontmatter string, or null when it set none.
 * @returns One entry per named tool, trimmed and with blanks dropped — empty
 * when `value` is null or names nothing.
 *
 * @remarks
 * The Agent Skills spec fixes no separator beyond the comma convention every
 * published Skill follows, and the Registry stores the string verbatim
 * (ADR-0009 validates that it *is* a string, nothing more). So this parses
 * leniently and the stored string stays the source of truth.
 *
 * @example
 * ```ts
 * splitAllowedTools("Read, Grep , ") // -> ["Read", "Grep"]
 * splitAllowedTools(null)            // -> []
 * ```
 */
export function splitAllowedTools(value: string | null): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0)
}

