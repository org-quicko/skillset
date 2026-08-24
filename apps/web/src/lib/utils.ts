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
