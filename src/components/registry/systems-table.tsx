"use client";

import { useMemo, useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { MoreHorizontal, Eye, Pencil, X } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Badge, riskBadgeVariant, statusBadgeVariant } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";

type SystemRow = {
  id: string;
  name: string;
  department: string;
  riskLevel: string;
  status: string;
  dataSensitivity: string;
  vendor: string | null;
  createdAt: string | Date;
  owner: { id: string; name: string | null };
  _count: { agents: number; riskAssessments: number };
  topRecommendation: string;
  topRecommendationTone: "critical" | "warning" | "success" | "info";
};

const columns: ColumnDef<SystemRow>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link
        href={`/registry/${row.original.id}`}
        className="font-medium text-[var(--accent)] hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "department",
    header: "Department",
  },
  {
    accessorKey: "owner.name",
    header: "Owner",
    cell: ({ row }) => row.original.owner.name ?? "—",
  },
  {
    accessorKey: "riskLevel",
    header: "Risk",
    cell: ({ row }) => (
      <Badge variant={riskBadgeVariant(row.original.riskLevel)}>
        {row.original.riskLevel}
      </Badge>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={statusBadgeVariant(row.original.status)}>
        {row.original.status.replace("_", " ")}
      </Badge>
    ),
  },
  {
    accessorKey: "dataSensitivity",
    header: "Data",
    cell: ({ row }) => (
      <Badge variant="outline">{row.original.dataSensitivity}</Badge>
    ),
  },
  {
    accessorKey: "_count.agents",
    header: "Agents",
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original._count.agents}</span>
    ),
  },
  {
    accessorKey: "topRecommendation",
    header: "Next Best Action",
    cell: ({ row }) => (
      <Badge variant={row.original.topRecommendationTone}>
        {row.original.topRecommendation}
      </Badge>
    ),
  },
  {
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => (
      <span className="text-[var(--text-faint)]">{formatDate(row.original.createdAt)}</span>
    ),
  },
  {
    id: "actions",
    cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <Link href={`/registry/${row.original.id}`}>
            <DropdownMenuItem>
              <Eye className="mr-2 h-4 w-4" /> View
            </DropdownMenuItem>
          </Link>
          <Link href={`/registry/${row.original.id}/edit`}>
            <DropdownMenuItem>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
          </Link>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
];

// Fixed enum orderings so the dropdowns stay consistent regardless of
// what's present in the current dataset.
const RISK_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "MINIMAL"];
const STATUS_ORDER = [
  "DRAFT",
  "UNDER_REVIEW",
  "APPROVED",
  "DEPLOYED",
  "DEPRECATED",
  "RETIRED",
];
const SENSITIVITY_ORDER = ["RESTRICTED", "CONFIDENTIAL", "INTERNAL", "PUBLIC"];

function sortByOrder(values: string[], order: string[]): string[] {
  return [...values].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

type FilterState = {
  department: string;
  riskLevel: string;
  status: string;
  dataSensitivity: string;
  vendor: string;
};

const EMPTY_FILTERS: FilterState = {
  department: "",
  riskLevel: "",
  status: "",
  dataSensitivity: "",
  vendor: "",
};

export function SystemsTable({ data }: { data: SystemRow[] }) {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);

  // Derive filter options from the current dataset so the dropdowns only
  // surface values the user can actually select to a non-empty result.
  const options = useMemo(() => {
    const departments = new Set<string>();
    const risks = new Set<string>();
    const statuses = new Set<string>();
    const sensitivities = new Set<string>();
    const vendors = new Set<string>();
    for (const row of data) {
      if (row.department) departments.add(row.department);
      if (row.riskLevel) risks.add(row.riskLevel);
      if (row.status) statuses.add(row.status);
      if (row.dataSensitivity) sensitivities.add(row.dataSensitivity);
      if (row.vendor) vendors.add(row.vendor);
    }
    return {
      departments: [...departments].sort((a, b) => a.localeCompare(b)),
      risks: sortByOrder([...risks], RISK_ORDER),
      statuses: sortByOrder([...statuses], STATUS_ORDER),
      sensitivities: sortByOrder([...sensitivities], SENSITIVITY_ORDER),
      vendors: [...vendors].sort((a, b) => a.localeCompare(b)),
    };
  }, [data]);

  const filteredData = useMemo(() => {
    return data.filter((row) => {
      if (filters.department && row.department !== filters.department) return false;
      if (filters.riskLevel && row.riskLevel !== filters.riskLevel) return false;
      if (filters.status && row.status !== filters.status) return false;
      if (filters.dataSensitivity && row.dataSensitivity !== filters.dataSensitivity) return false;
      if (filters.vendor && row.vendor !== filters.vendor) return false;
      return true;
    });
  }, [data, filters]);

  const anyActive = Object.values(filters).some((v) => v !== "");
  const selectClass =
    "flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none";

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">
            Filters
          </p>
          {anyActive && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setFilters(EMPTY_FILTERS)}
            >
              <X className="h-3 w-3" />
              Clear all
            </Button>
          )}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1.5">
            <Label className="text-[11px] text-[var(--text-muted)]">Department</Label>
            <select
              className={selectClass}
              value={filters.department}
              onChange={(e) => setFilters((f) => ({ ...f, department: e.target.value }))}
            >
              <option value="">All departments</option>
              {options.departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-[var(--text-muted)]">Risk level</Label>
            <select
              className={selectClass}
              value={filters.riskLevel}
              onChange={(e) => setFilters((f) => ({ ...f, riskLevel: e.target.value }))}
            >
              <option value="">All risk levels</option>
              {options.risks.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-[var(--text-muted)]">Status</Label>
            <select
              className={selectClass}
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="">All statuses</option>
              {options.statuses.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-[var(--text-muted)]">Data sensitivity</Label>
            <select
              className={selectClass}
              value={filters.dataSensitivity}
              onChange={(e) => setFilters((f) => ({ ...f, dataSensitivity: e.target.value }))}
            >
              <option value="">All sensitivities</option>
              {options.sensitivities.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-[var(--text-muted)]">Vendor</Label>
            <select
              className={selectClass}
              value={filters.vendor}
              onChange={(e) => setFilters((f) => ({ ...f, vendor: e.target.value }))}
            >
              <option value="">All vendors</option>
              {options.vendors.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
        {anyActive && (
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            Showing {filteredData.length} of {data.length} systems
          </p>
        )}
      </div>
      <DataTable
        columns={columns}
        data={filteredData}
        searchKey="name"
        searchPlaceholder="Search AI systems..."
      />
    </div>
  );
}
