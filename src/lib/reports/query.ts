import {
  buildWhere,
  dateRangeLabel,
  delegateFor,
  getCellValue,
  getColumn,
  getDataSource,
  resolveColumns,
} from "./data-sources";
import type {
  ReportConfig,
  ReportDataSourceKey,
  ReportFilter,
  ReportOutputColumn,
  ReportResult,
  ReportRunOverrides,
} from "./types";

const DEFAULT_ROW_LIMIT = 5000;
const MAX_ROW_LIMIT = 50000;

function humanizeFilters(
  source: ReturnType<typeof getDataSource>,
  filters: ReportFilter[] | undefined
): string[] {
  const opLabel: Record<string, string> = {
    eq: "=",
    ne: "≠",
    contains: "contains",
    gt: ">",
    gte: "≥",
    lt: "<",
    lte: "≤",
    in: "in",
  };
  return (filters ?? [])
    .map((f) => {
      const col = getColumn(source, f.field);
      if (!col?.field) return null;
      const v = Array.isArray(f.value) ? f.value.join(", ") : f.value;
      return `${col.label} ${opLabel[f.operator] ?? f.operator} ${v}`;
    })
    .filter((s): s is string => Boolean(s));
}

/**
 * Execute a report definition against the database. Supports two modes:
 *  - detail (no groupBy): a filtered, sorted, column-projected row set
 *  - grouped (groupBy set): aggregated counts + sum/avg of numeric columns
 */
export async function runReportQuery(
  dataSource: ReportDataSourceKey,
  config: ReportConfig,
  overrides?: ReportRunOverrides
): Promise<ReportResult> {
  const source = getDataSource(dataSource);
  const delegate = delegateFor(source);
  const dateRange = overrides?.dateRange ?? config.dateRange;
  const where = buildWhere(source, config.filters, dateRange);
  const rowLimit = Math.min(
    Math.max(overrides?.rowLimit ?? config.rowLimit ?? DEFAULT_ROW_LIMIT, 1),
    MAX_ROW_LIMIT
  );

  const appliedFilters = humanizeFilters(source, config.filters);
  const groupColumn = config.groupBy ? getColumn(source, config.groupBy) : undefined;

  // ── Grouped mode ─────────────────────────────────────────────────────────
  if (groupColumn?.field) {
    const selected = resolveColumns(source, config.columns);
    const numeric = selected.filter(
      (c) => c.field && (c.type === "number" || c.type === "currency")
    );
    const _sum: Record<string, true> = {};
    const _avg: Record<string, true> = {};
    for (const col of numeric) {
      if (col.aggregate === "avg") _avg[col.field!] = true;
      else _sum[col.field!] = true;
    }

    const groups = (await delegate.groupBy({
      by: [groupColumn.field],
      where,
      _count: { _all: true },
      ...(Object.keys(_sum).length ? { _sum } : {}),
      ...(Object.keys(_avg).length ? { _avg } : {}),
    })) as Array<Record<string, unknown>>;

    const columns: ReportOutputColumn[] = [
      { key: groupColumn.key, label: groupColumn.label, type: groupColumn.type },
      { key: "_count", label: "Count", type: "number" },
      ...numeric.map((c) => ({
        key: `agg_${c.key}`,
        label: `${c.aggregate === "avg" ? "Avg" : "Total"} ${c.label}`,
        type: c.type,
      })),
    ];

    const rows = groups
      .map((g) => {
        const row: Record<string, string | number | boolean | null> = {};
        const groupVal = g[groupColumn.field!];
        row[groupColumn.key] =
          groupVal == null
            ? null
            : groupVal instanceof Date
              ? groupVal.toISOString()
              : (groupVal as string | number | boolean);
        const count = (g._count as { _all?: number } | undefined)?._all ?? 0;
        row._count = count;
        for (const c of numeric) {
          const bag = (c.aggregate === "avg" ? g._avg : g._sum) as
            | Record<string, number | null>
            | undefined;
          const value = bag?.[c.field!] ?? 0;
          row[`agg_${c.key}`] =
            c.aggregate === "avg" ? Math.round(value * 100) / 100 : value;
        }
        return row;
      })
      .sort((a, b) => Number(b._count ?? 0) - Number(a._count ?? 0))
      .slice(0, rowLimit);

    return {
      source: { key: source.key, label: source.label },
      columns,
      rows,
      totalRows: rows.length,
      grouped: true,
      appliedFilters,
      dateRangeLabel: dateRangeLabel(dateRange),
      chartType: config.chartType ?? "none",
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Detail mode ──────────────────────────────────────────────────────────
  const selected = resolveColumns(source, config.columns);
  const sortColumn = config.sort ? getColumn(source, config.sort.field) : undefined;
  const orderBy = sortColumn?.field
    ? { [sortColumn.field]: config.sort!.direction }
    : { [source.dateField]: "desc" as const };

  const [records, totalRows] = await Promise.all([
    delegate.findMany({
      where,
      include: source.include,
      orderBy,
      take: rowLimit,
    }),
    delegate.count({ where }),
  ]);

  const columns: ReportOutputColumn[] = selected.map((c) => ({
    key: c.key,
    label: c.label,
    type: c.type,
  }));

  const rows = records.map((record) => {
    const row: Record<string, string | number | boolean | null> = {};
    for (const c of selected) row[c.key] = getCellValue(record, c);
    return row;
  });

  return {
    source: { key: source.key, label: source.label },
    columns,
    rows,
    totalRows,
    grouped: false,
    appliedFilters,
    dateRangeLabel: dateRangeLabel(dateRange),
    chartType: config.chartType ?? "none",
    generatedAt: new Date().toISOString(),
  };
}
