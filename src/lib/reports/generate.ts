import { runReportQuery } from "./query";
import { renderReportCsv } from "./export/csv";
import { renderReportJson } from "./export/json";
import { CONTENT_TYPES, reportFilename } from "./export/format";
import type {
  ReportConfig,
  ReportDataSourceKey,
  ReportFormatKey,
  ReportRunOverrides,
} from "./types";

export interface GeneratableReport {
  name: string;
  description?: string | null;
  dataSource: ReportDataSourceKey;
  config: ReportConfig;
}

export interface GeneratedReport {
  buffer: Buffer;
  contentType: string;
  filename: string;
  rowCount: number;
}

const EXT: Record<ReportFormatKey, string> = { PDF: "pdf", CSV: "csv", JSON: "json" };

/**
 * Run a report and render it to the requested format. PDF rendering is
 * dynamically imported so the heavy @react-pdf/renderer dependency is only
 * loaded in the Node runtime when a PDF is actually requested.
 */
export async function generateReport(
  report: GeneratableReport,
  format: ReportFormatKey,
  options?: { overrides?: ReportRunOverrides; generatedBy?: string | null }
): Promise<GeneratedReport> {
  const result = await runReportQuery(report.dataSource, report.config, options?.overrides);

  let buffer: Buffer;
  if (format === "CSV") {
    buffer = renderReportCsv(result);
  } else if (format === "JSON") {
    buffer = renderReportJson(result, { name: report.name, description: report.description });
  } else {
    const { renderReportPdf } = await import("./export/pdf");
    buffer = await renderReportPdf(result, {
      name: report.name,
      description: report.description,
      generatedBy: options?.generatedBy ?? null,
    });
  }

  return {
    buffer,
    contentType: CONTENT_TYPES[format],
    filename: reportFilename(report.name, EXT[format]),
    rowCount: result.totalRows,
  };
}
