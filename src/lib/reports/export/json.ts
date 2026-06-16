import type { ReportResult } from "../types";

// Render a report result to a machine-readable JSON buffer. Includes metadata
// (filters, date range, generation time) alongside the raw normalized rows.
export function renderReportJson(
  result: ReportResult,
  meta: { name: string; description?: string | null }
): Buffer {
  const payload = {
    report: {
      name: meta.name,
      description: meta.description ?? null,
      dataSource: result.source.key,
      dataSourceLabel: result.source.label,
      grouped: result.grouped,
      generatedAt: result.generatedAt,
      dateRange: result.dateRangeLabel,
      filters: result.appliedFilters,
      totalRows: result.totalRows,
    },
    columns: result.columns,
    rows: result.rows,
  };
  return Buffer.from(JSON.stringify(payload, null, 2), "utf-8");
}
