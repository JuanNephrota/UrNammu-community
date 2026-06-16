import type { ReportResult } from "../types";
import { formatCell } from "./format";

function escapeCsv(value: string): string {
  // RFC 4180: quote fields containing comma, quote, CR or LF; double inner quotes.
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Render a report result to a UTF-8 CSV buffer. A BOM is prepended so Excel
// detects the encoding and renders unicode + leading-zero values correctly.
export function renderReportCsv(result: ReportResult): Buffer {
  const header = result.columns.map((c) => escapeCsv(c.label)).join(",");
  const lines = result.rows.map((row) =>
    result.columns
      .map((c) => escapeCsv(formatCell(row[c.key] ?? null, c.type)))
      .join(",")
  );
  const body = [header, ...lines].join("\r\n");
  return Buffer.from("﻿" + body, "utf-8");
}
