"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReportPreview } from "./report-preview";
import type {
  ChartType,
  DateRangePreset,
  FilterOperator,
  ReportConfig,
  ReportDataSourceKey,
} from "@/lib/reports/types";

// Serialized registry shape (matches serializeRegistry() on the server).
export interface RegistryColumn {
  key: string;
  label: string;
  type: string;
  filterable: boolean;
  groupable: boolean;
  enumOptions: string[] | null;
}
export interface RegistrySource {
  key: ReportDataSourceKey;
  label: string;
  description: string;
  dateField: string;
  columns: RegistryColumn[];
  defaultColumns: string[];
}

interface UiFilter {
  field: string;
  operator: FilterOperator;
  value: string;
}

interface InitialReport {
  id: string;
  name: string;
  description: string | null;
  dataSource: ReportDataSourceKey;
  visibility: "PRIVATE" | "SHARED";
  config: ReportConfig;
}

const OPERATORS_BY_TYPE: Record<string, { value: FilterOperator; label: string }[]> = {
  string: [
    { value: "contains", label: "contains" },
    { value: "eq", label: "equals" },
    { value: "ne", label: "not equals" },
  ],
  enum: [
    { value: "eq", label: "is" },
    { value: "ne", label: "is not" },
    { value: "in", label: "is any of" },
  ],
  number: [
    { value: "eq", label: "=" },
    { value: "gt", label: ">" },
    { value: "gte", label: "≥" },
    { value: "lt", label: "<" },
    { value: "lte", label: "≤" },
  ],
  currency: [
    { value: "eq", label: "=" },
    { value: "gt", label: ">" },
    { value: "gte", label: "≥" },
    { value: "lt", label: "<" },
    { value: "lte", label: "≤" },
  ],
  boolean: [{ value: "eq", label: "is" }],
  date: [
    { value: "gte", label: "on/after" },
    { value: "lte", label: "on/before" },
  ],
};

function operatorsFor(type: string) {
  return OPERATORS_BY_TYPE[type] ?? OPERATORS_BY_TYPE.string;
}

export function ReportBuilder({
  registry,
  initial,
}: {
  registry: RegistrySource[];
  initial?: InitialReport;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [visibility, setVisibility] = useState<"PRIVATE" | "SHARED">(
    initial?.visibility ?? "PRIVATE"
  );
  const [dataSource, setDataSource] = useState<ReportDataSourceKey>(
    initial?.dataSource ?? registry[0].key
  );
  const [columns, setColumns] = useState<string[]>(initial?.config.columns ?? []);
  const [filters, setFilters] = useState<UiFilter[]>(
    (initial?.config.filters ?? []).map((f) => ({
      field: f.field,
      operator: f.operator,
      value: Array.isArray(f.value) ? f.value.join(", ") : f.value,
    }))
  );
  const [groupBy, setGroupBy] = useState<string>(initial?.config.groupBy ?? "");
  const [datePreset, setDatePreset] = useState<DateRangePreset>(
    initial?.config.dateRange?.preset ?? "all"
  );
  const [sortField, setSortField] = useState<string>(initial?.config.sort?.field ?? "");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(
    initial?.config.sort?.direction ?? "desc"
  );
  const [chartType, setChartType] = useState<ChartType>(
    initial?.config.chartType ?? "none"
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const source = useMemo(
    () => registry.find((s) => s.key === dataSource) ?? registry[0],
    [registry, dataSource]
  );

  function switchSource(key: ReportDataSourceKey) {
    const next = registry.find((s) => s.key === key);
    if (!next) return;
    setDataSource(key);
    setColumns(next.defaultColumns);
    setFilters([]);
    setGroupBy("");
    setSortField("");
    setChartType("none");
  }

  function toggleColumn(key: string) {
    setColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  // Display selected columns in source order for stability.
  const orderedColumns = useMemo(
    () => source.columns.filter((c) => columns.includes(c.key)).map((c) => c.key),
    [source, columns]
  );

  const config: ReportConfig = useMemo(() => {
    const cfg: ReportConfig = {
      columns: orderedColumns.length ? orderedColumns : source.defaultColumns,
    };
    if (filters.length) {
      cfg.filters = filters
        .filter((f) => f.field && f.value !== "")
        .map((f) => ({
          field: f.field,
          operator: f.operator,
          value:
            f.operator === "in"
              ? f.value.split(",").map((v) => v.trim()).filter(Boolean)
              : f.value,
        }));
    }
    if (groupBy) cfg.groupBy = groupBy;
    if (datePreset && datePreset !== "all") cfg.dateRange = { preset: datePreset };
    if (sortField && !groupBy) cfg.sort = { field: sortField, direction: sortDir };
    if (chartType !== "none") cfg.chartType = chartType;
    return cfg;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedColumns, JSON.stringify(filters), groupBy, datePreset, sortField, sortDir, chartType]);

  async function save() {
    if (!name.trim()) {
      setError("Give the report a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        dataSource,
        config,
        visibility,
      };
      const res = await fetch(
        initial ? `/api/reports/${initial.id}` : "/api/reports",
        {
          method: initial ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Save failed");
      router.push(`/reports/${initial ? initial.id : data.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  }

  const groupableColumns = source.columns.filter((c) => c.groupable);
  const filterableColumns = source.columns.filter((c) => c.filterable);
  const sortableColumns = source.columns.filter((c) => c.filterable);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
      {/* Builder controls */}
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q2 Risk Posture" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Description</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional summary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Visibility</label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v as "PRIVATE" | "SHARED")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PRIVATE">Private (only me)</SelectItem>
                  <SelectItem value="SHARED">Shared (whole org)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Data & Columns</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Data source</label>
              <Select value={dataSource} onValueChange={(v) => switchSource(v as ReportDataSourceKey)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {registry.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-[var(--text-faint)]">{source.description}</p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">
                Columns {groupBy && "(numeric columns roll up in the grouped summary)"}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {source.columns.map((c) => {
                  const active = columns.includes(c.key);
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => toggleColumn(c.key)}
                      className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                        active
                          ? "border-[var(--accent-border)] bg-[var(--accent-dim)] text-[var(--accent)]"
                          : "border-[var(--border-default)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Shape</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Group by</label>
              <Select value={groupBy || "__none"} onValueChange={(v) => setGroupBy(v === "__none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No grouping (detail rows)</SelectItem>
                  {groupableColumns.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Date range</label>
                <Select value={datePreset} onValueChange={(v) => setDatePreset(v as DateRangePreset)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All time</SelectItem>
                    <SelectItem value="7d">Last 7 days</SelectItem>
                    <SelectItem value="30d">Last 30 days</SelectItem>
                    <SelectItem value="90d">Last 90 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                  {groupBy ? "Chart" : "Sort"}
                </label>
                {groupBy ? (
                  <Select value={chartType} onValueChange={(v) => setChartType(v as ChartType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Table only</SelectItem>
                      <SelectItem value="bar">Bar chart</SelectItem>
                      <SelectItem value="line">Line chart</SelectItem>
                      <SelectItem value="pie">Pie chart</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex gap-1.5">
                    <Select value={sortField || "__default"} onValueChange={(v) => setSortField(v === "__default" ? "" : v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__default">Default</SelectItem>
                        {sortableColumns.map((c) => (
                          <SelectItem key={c.key} value={c.key}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={sortDir} onValueChange={(v) => setSortDir(v as "asc" | "desc")}>
                      <SelectTrigger className="w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="desc">↓</SelectItem>
                        <SelectItem value="asc">↑</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Filters</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setFilters((prev) => [
                  ...prev,
                  {
                    field: filterableColumns[0]?.key ?? "",
                    operator: operatorsFor(filterableColumns[0]?.type ?? "string")[0].value,
                    value: "",
                  },
                ])
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {filters.length === 0 && (
              <p className="text-xs text-[var(--text-faint)]">No filters — all rows included.</p>
            )}
            {filters.map((filter, i) => {
              const col = source.columns.find((c) => c.key === filter.field);
              const ops = operatorsFor(col?.type ?? "string");
              return (
                <div key={i} className="flex items-center gap-1.5">
                  <Select
                    value={filter.field}
                    onValueChange={(v) => {
                      const newCol = source.columns.find((c) => c.key === v);
                      setFilters((prev) =>
                        prev.map((f, idx) =>
                          idx === i
                            ? { field: v, operator: operatorsFor(newCol?.type ?? "string")[0].value, value: "" }
                            : f
                        )
                      );
                    }}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {filterableColumns.map((c) => (
                        <SelectItem key={c.key} value={c.key}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={filter.operator}
                    onValueChange={(v) =>
                      setFilters((prev) => prev.map((f, idx) => (idx === i ? { ...f, operator: v as FilterOperator } : f)))
                    }
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ops.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {col?.type === "enum" && filter.operator !== "in" && col.enumOptions ? (
                    <Select
                      value={filter.value || col.enumOptions[0]}
                      onValueChange={(v) =>
                        setFilters((prev) => prev.map((f, idx) => (idx === i ? { ...f, value: v } : f)))
                      }
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {col.enumOptions.map((o) => (
                          <SelectItem key={o} value={o}>
                            {o}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : col?.type === "boolean" ? (
                    <Select
                      value={filter.value || "true"}
                      onValueChange={(v) =>
                        setFilters((prev) => prev.map((f, idx) => (idx === i ? { ...f, value: v } : f)))
                      }
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Yes</SelectItem>
                        <SelectItem value="false">No</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      className="flex-1"
                      value={filter.value}
                      placeholder={filter.operator === "in" ? "a, b, c" : "value"}
                      onChange={(e) =>
                        setFilters((prev) => prev.map((f, idx) => (idx === i ? { ...f, value: e.target.value } : f)))
                      }
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setFilters((prev) => prev.filter((_, idx) => idx !== i))}
                    className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--critical-strong)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {initial ? "Save changes" : "Save report"}
          </Button>
          {error && <span className="text-sm text-[var(--critical-strong)]">{error}</span>}
        </div>
      </div>

      {/* Live preview */}
      <div>
        <Card className="sticky top-0">
          <CardHeader>
            <CardTitle>Live Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <ReportPreview dataSource={dataSource} config={config} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
