import type { ColumnType, ReportResult } from "../types";

// Human-friendly rendering of a normalized cell value for display/export.
export function formatCell(
  value: string | number | boolean | null,
  type: ColumnType
): string {
  if (value === null || value === undefined) return "";
  if (type === "boolean") return value ? "Yes" : "No";
  if (type === "currency") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n)
      ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
      : String(value);
  }
  if (type === "number") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n.toLocaleString("en-US") : String(value);
  }
  if (type === "date") {
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
  }
  return String(value);
}

// A safe, filesystem-friendly base filename for a report run.
export function reportFilename(name: string, ext: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "report";
  const stamp = new Date().toISOString().slice(0, 10);
  return `${slug}-${stamp}.${ext}`;
}

export const CONTENT_TYPES: Record<string, string> = {
  PDF: "application/pdf",
  CSV: "text/csv; charset=utf-8",
  JSON: "application/json",
};

export type { ReportResult };
