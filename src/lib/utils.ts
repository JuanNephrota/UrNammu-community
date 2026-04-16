import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateForInput(date: Date | string | null | undefined): string {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

// Compact decimal notation for large counts (tokens, requests, etc).
//   999        -> "999"
//   1,234      -> "1.23K"
//   456,237    -> "456K"
//   1,234,567  -> "1.23M"
//   345,678,987 -> "346M"
//   1.2e9      -> "1.2B"
// Values under 1,000 render as plain integers with thousands separators.
//
// The locale is pinned to "en-US" explicitly. Bare `toLocaleString()` uses
// the server/runtime default locale which on Vercel can be non-US (e.g.
// German), producing European-style periods as thousand separators.
const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});
const plainFormatter = new Intl.NumberFormat("en-US");
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) < 1000) return plainFormatter.format(value);
  return compactFormatter.format(value);
}

/** Always formats integers with US-style thousand separators ("1,234,567"). */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return plainFormatter.format(value);
}
