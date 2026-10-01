import type { ReportResult } from "../types";
import { formatCell } from "./format";
import { csvField } from "../../csv-safe";

// RFC 4180 quoting plus spreadsheet-formula neutralization.
const escapeCsv = csvField;

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
