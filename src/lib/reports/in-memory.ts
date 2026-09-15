import type { SourceColumn } from "./data-sources";
import type { ColumnType, FilterOperator, ReportFilter, ReportOutputColumn, ReportSort } from "./types";

// In-memory filter / sort / group for computed data sources — sources whose
// rows come from a loader function (cross-table aggregations) rather than a
// single Prisma model. Mirrors the semantics runReportQuery gets from Prisma
// for model-backed sources so the builder UI behaves identically.

export type Cell = string | number | boolean | null;
export type Row = Record<string, unknown>;

const NULL_GROUP_KEY = "__null__";

function coerce(type: ColumnType, raw: string): string | number | boolean {
  if (type === "number" || type === "currency") return Number(raw);
  if (type === "boolean") return raw === "true";
  return raw;
}

function comparable(type: ColumnType, value: unknown): number | string | null {
  if (value == null) return null;
  if (type === "number" || type === "currency") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "date") {
    const t = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (type === "boolean") return value ? 1 : 0;
  return String(value);
}

export function matchesFilter(value: unknown, filter: ReportFilter, column: SourceColumn): boolean {
  const op: FilterOperator = filter.operator;
  if (op === "in") {
    const wanted = (Array.isArray(filter.value) ? filter.value : [filter.value]).map(String);
    return value != null && wanted.includes(String(value));
  }
  const raw = Array.isArray(filter.value) ? filter.value[0] ?? "" : filter.value;
  if (op === "contains") {
    return value != null && String(value).toLowerCase().includes(raw.toLowerCase());
  }
  const left = comparable(column.type, value);
  const right = comparable(column.type, column.type === "date" ? raw : coerce(column.type, raw));
  if (op === "eq") return left !== null && right !== null && left === right;
  if (op === "ne") return left !== right;
  if (left === null || right === null) return false;
  switch (op) {
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
  }
  return false;
}

export function filterRows(
  rows: Row[],
  filters: ReportFilter[] | undefined,
  columnFor: (key: string) => SourceColumn | undefined,
): Row[] {
  const active = (filters ?? [])
    .map((f) => ({ filter: f, column: columnFor(f.field) }))
    .filter((f): f is { filter: ReportFilter; column: SourceColumn } => Boolean(f.column));
  if (active.length === 0) return rows;
  return rows.filter((row) => active.every(({ filter, column }) => matchesFilter(row[column.key], filter, column)));
}

export function sortRows(rows: Row[], sort: ReportSort | undefined, column: SourceColumn | undefined): Row[] {
  if (!sort || !column) return rows;
  const dir = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const l = comparable(column.type, a[column.key]);
    const r = comparable(column.type, b[column.key]);
    if (l === null && r === null) return 0;
    if (l === null) return 1; // nulls last regardless of direction
    if (r === null) return -1;
    if (l < r) return -1 * dir;
    if (l > r) return 1 * dir;
    return 0;
  });
}

export function toCell(value: unknown): Cell {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

/**
 * Group rows by one column, counting rows and summing (or averaging) each
 * numeric column. Output shape matches the Prisma-backed grouped mode:
 * `<groupKey>`, `_count`, then `agg_<key>` per numeric column.
 */
export function groupRows(
  rows: Row[],
  groupColumn: SourceColumn,
  numericColumns: SourceColumn[],
): { columns: ReportOutputColumn[]; rows: Record<string, Cell>[] } {
  const groups = new Map<
    string,
    { value: Cell; count: number; sums: Record<string, number>; nonNull: Record<string, number> }
  >();
  for (const row of rows) {
    const value = toCell(row[groupColumn.key]);
    const key = value === null ? NULL_GROUP_KEY : `v:${String(value)}`;
    let g = groups.get(key);
    if (!g) {
      g = { value, count: 0, sums: {}, nonNull: {} };
      groups.set(key, g);
    }
    g.count += 1;
    for (const c of numericColumns) {
      const v = row[c.key];
      const num = typeof v === "number" ? v : v == null ? null : Number(v);
      if (num === null || !Number.isFinite(num)) continue;
      g.sums[c.key] = (g.sums[c.key] ?? 0) + num;
      g.nonNull[c.key] = (g.nonNull[c.key] ?? 0) + 1;
    }
  }

  const columns: ReportOutputColumn[] = [
    { key: groupColumn.key, label: groupColumn.label, type: groupColumn.type },
    { key: "_count", label: "Count", type: "number" },
    ...numericColumns.map((c) => ({
      key: `agg_${c.key}`,
      label: `${c.aggregate === "avg" ? "Avg" : "Total"} ${c.label}`,
      type: c.type,
    })),
  ];

  const out = [...groups.values()]
    .map((g) => {
      const row: Record<string, Cell> = { [groupColumn.key]: g.value, _count: g.count };
      for (const c of numericColumns) {
        const sum = g.sums[c.key] ?? 0;
        const value = c.aggregate === "avg" ? (g.nonNull[c.key] ? sum / g.nonNull[c.key] : 0) : sum;
        row[`agg_${c.key}`] = Math.round(value * 100) / 100;
      }
      return row;
    })
    .sort((a, b) => Number(b._count ?? 0) - Number(a._count ?? 0));

  return { columns, rows: out };
}
