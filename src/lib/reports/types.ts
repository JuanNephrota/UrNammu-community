// Shared types for the reporting suite. The data-source registry
// (data-sources.ts) is the single source of truth for what can be reported;
// the builder UI, query engine, and exporters all derive from these types.

export type ReportDataSourceKey =
  | "AI_SYSTEMS"
  | "AI_AGENTS"
  | "RISK_ASSESSMENTS"
  | "COMPLIANCE"
  | "API_USAGE"
  | "ALERTS"
  | "SHADOW_AI"
  | "AUDIT_LOG";

export type ReportFormatKey = "PDF" | "CSV" | "JSON";

export type ColumnType =
  | "string"
  | "number"
  | "currency"
  | "date"
  | "enum"
  | "boolean";

export type FilterOperator =
  | "eq"
  | "ne"
  | "contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in";

export type DateRangePreset = "7d" | "30d" | "90d" | "all" | "custom";

export type ChartType = "none" | "bar" | "line" | "pie";

export interface ReportFilter {
  field: string; // column key
  operator: FilterOperator;
  value: string | string[];
}

export interface ReportDateRange {
  preset?: DateRangePreset;
  from?: string; // ISO, when preset === "custom"
  to?: string; // ISO, when preset === "custom"
}

export interface ReportSort {
  field: string; // column key
  direction: "asc" | "desc";
}

// Persisted JSON shape of ReportDefinition.config
export interface ReportConfig {
  columns: string[]; // ordered column keys
  filters?: ReportFilter[];
  groupBy?: string; // scalar column key → aggregation mode
  dateRange?: ReportDateRange;
  sort?: ReportSort;
  chartType?: ChartType;
  rowLimit?: number;
}

// A single overrideable run-time parameter set (e.g. preview narrows rows).
export interface ReportRunOverrides {
  rowLimit?: number;
  dateRange?: ReportDateRange;
}

// ── Output of runReportQuery ──────────────────────────────────────────────

export interface ReportOutputColumn {
  key: string;
  label: string;
  type: ColumnType;
}

export interface ReportResult {
  source: { key: ReportDataSourceKey; label: string };
  columns: ReportOutputColumn[];
  rows: Record<string, string | number | boolean | null>[];
  totalRows: number;
  grouped: boolean;
  appliedFilters: string[]; // human-readable, for export headers
  dateRangeLabel: string | null;
  chartType: ChartType;
  generatedAt: string; // ISO
}
