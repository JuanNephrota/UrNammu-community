"use client";

import Link from "next/link";
import { type ColumnDef, type Column } from "@tanstack/react-table";
import { ArrowUpDown, Bot, Download, MousePointer2, Network, Terminal } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { formatCompactNumber, formatDate } from "@/lib/utils";
import {
  SURFACE_LABELS,
  SURFACE_ORDER,
  type PersonSurface,
  type PersonUsageRow,
} from "@/lib/people-usage-types";

// Serializable shape handed from the server page (Dates become ISO strings).
export type PersonUsageTableRow = Omit<PersonUsageRow, "lastActiveAt"> & {
  lastActiveAt: string | null;
};

const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });

const SURFACE_LINKS: Record<PersonSurface, ((email: string) => string) | null> = {
  claude_code: (email) => `/oversight/claude-code?user=${encodeURIComponent(email)}`,
  cowork: (email) => `/oversight/cowork?user=${encodeURIComponent(email)}`,
  cursor: (email) => `/oversight/cursor?user=${encodeURIComponent(email)}`,
  proxy: null,
};

function SurfaceIcon({ surface }: { surface: PersonSurface }) {
  const cls = "h-3.5 w-3.5";
  if (surface === "claude_code") return <Terminal className={cls} />;
  if (surface === "cowork") return <Bot className={cls} />;
  if (surface === "cursor") return <MousePointer2 className={cls} />;
  return <Network className={cls} />;
}

function SortableHeader<T>({ column, label, align = "left" }: { column: Column<T, unknown>; label: string; align?: "left" | "right" }) {
  return (
    <button
      type="button"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      className={`inline-flex items-center gap-1 hover:text-[var(--text-primary)] ${align === "right" ? "w-full justify-end" : ""}`}
    >
      {label}
      <ArrowUpDown className="h-3 w-3 opacity-60" />
    </button>
  );
}

function Money({ value, muted }: { value: number | null; muted?: boolean }) {
  if (value === null) return <span className="text-[var(--text-faint)]" title="No per-user spend synced for this window">n/a</span>;
  if (value === 0) return <span className="text-[var(--text-faint)]">—</span>;
  return <span className={muted ? "" : "tabular-nums"}>{usd(value)}</span>;
}

// CSV covers every column (not just the visible ones) so the download is the
// full dataset for spreadsheet analysis.
const CSV_COLUMNS: { key: keyof PersonUsageTableRow; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "department", label: "Department" },
  { key: "surfaces", label: "Surfaces" },
  { key: "totalCost", label: "Total Cost (USD)" },
  { key: "totalTokens", label: "Total Tokens" },
  { key: "claudeCodeCost", label: "Claude Code Cost (USD)" },
  { key: "claudeCodeSessions", label: "Claude Code Sessions" },
  { key: "claudeCodeTokens", label: "Claude Code Tokens" },
  { key: "claudeCodeLinesAdded", label: "Claude Code Lines Added" },
  { key: "claudeCodeCommits", label: "Claude Code Commits" },
  { key: "claudeCodeSource", label: "Claude Code Source" },
  { key: "coworkCost", label: "Cowork Cost (USD)" },
  { key: "coworkSessions", label: "Cowork Sessions" },
  { key: "coworkTokens", label: "Cowork Tokens" },
  { key: "cursorCost", label: "Cursor Cost (USD)" },
  { key: "cursorRequests", label: "Cursor Requests" },
  { key: "cursorTokens", label: "Cursor Tokens" },
  { key: "cursorLinesAccepted", label: "Cursor Lines Accepted" },
  { key: "cursorActiveDays", label: "Cursor Active Days" },
  { key: "proxyCost", label: "API (proxy) Cost (USD)" },
  { key: "proxyRequests", label: "API (proxy) Requests" },
  { key: "proxyTokens", label: "API (proxy) Tokens" },
  { key: "proxyFlagged", label: "API (proxy) Flagged" },
  { key: "lastActiveAt", label: "Last Active" },
];

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = Array.isArray(v) ? v.map((x) => SURFACE_LABELS[x as PersonSurface] ?? String(x)).join("; ") : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(rows: PersonUsageTableRow[], filename: string) {
  const lines = [
    CSV_COLUMNS.map((c) => csvEscape(c.label)).join(","),
    ...rows.map((r) => CSV_COLUMNS.map((c) => csvEscape(r[c.key])).join(",")),
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const columns: ColumnDef<PersonUsageTableRow>[] = [
  {
    id: "person",
    accessorFn: (r) => `${r.name ?? ""} ${r.email} ${r.department ?? ""}`,
    header: ({ column }) => <SortableHeader column={column} label="Person" />,
    cell: ({ row }) => {
      const r = row.original;
      return (
        <div className="min-w-[160px] max-w-[260px]">
          <p className="truncate text-sm font-medium text-[var(--text-primary)]">{r.name ?? r.email}</p>
          <p className="truncate text-xs text-[var(--text-muted)]">
            {r.name ? r.email : null}
            {r.name && r.department ? " · " : null}
            {r.department}
          </p>
        </div>
      );
    },
  },
  {
    id: "surfaces",
    accessorFn: (r) => r.surfaceCount,
    header: ({ column }) => <SortableHeader column={column} label="Surfaces" />,
    cell: ({ row }) => {
      const r = row.original;
      return (
        <div className="flex flex-nowrap gap-1">
          {SURFACE_ORDER.filter((s) => r.surfaces.includes(s)).map((s) => {
            const href = SURFACE_LINKS[s]?.(r.email);
            // Icon-only chips keep the column narrow; the label lives in the
            // tooltip and (for screen readers) in the visually hidden span.
            const chip = (
              <span
                key={s}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
                title={href ? `${SURFACE_LABELS[s]} — open filtered to this person` : SURFACE_LABELS[s]}
              >
                <SurfaceIcon surface={s} />
                <span className="sr-only">{SURFACE_LABELS[s]}</span>
              </span>
            );
            return href ? (
              <Link key={s} href={href}>
                {chip}
              </Link>
            ) : (
              chip
            );
          })}
        </div>
      );
    },
  },
  {
    accessorKey: "claudeCodeCost",
    header: ({ column }) => <SortableHeader column={column} label="Claude Code" align="right" />,
    cell: ({ row }) => (
      <div className="text-right">
        <Money value={row.original.claudeCodeCost} />
        {row.original.claudeCodeSource === "admin_api" && (
          <span className="ml-1 text-[10px] uppercase tracking-wider text-[var(--text-faint)]" title="From the Anthropic Admin API analytics sync (no OTel data for this person)">
            est.
          </span>
        )}
      </div>
    ),
  },
  {
    accessorKey: "coworkCost",
    header: ({ column }) => <SortableHeader column={column} label="Cowork" align="right" />,
    cell: ({ row }) => (
      <div className="text-right">
        <Money value={row.original.coworkCost} />
      </div>
    ),
  },
  {
    accessorKey: "cursorCost",
    header: ({ column }) => <SortableHeader column={column} label="Cursor" align="right" />,
    sortUndefined: "last",
    cell: ({ row }) => (
      <div className="text-right">
        <Money value={row.original.cursorCost} />
      </div>
    ),
  },
  {
    accessorKey: "proxyCost",
    header: ({ column }) => <SortableHeader column={column} label="API (proxy)" align="right" />,
    cell: ({ row }) => (
      <div className="text-right">
        <Money value={row.original.proxyCost} />
        {row.original.proxyFlagged > 0 && (
          <span className="ml-1 text-[10px] text-[var(--warning)]" title="Flagged proxy requests in this window">
            {row.original.proxyFlagged} flagged
          </span>
        )}
      </div>
    ),
  },
  {
    accessorKey: "totalCost",
    header: ({ column }) => <SortableHeader column={column} label="Total" align="right" />,
    cell: ({ row }) => (
      <div className="text-right font-semibold text-[var(--text-primary)] tabular-nums">
        {row.original.totalCost > 0 ? usd(row.original.totalCost) : <span className="text-[var(--text-faint)]">—</span>}
      </div>
    ),
  },
  {
    accessorKey: "totalTokens",
    header: ({ column }) => <SortableHeader column={column} label="Tokens" align="right" />,
    cell: ({ row }) => (
      <div className="text-right tabular-nums" title={row.original.totalTokens.toLocaleString("en-US")}>
        {row.original.totalTokens > 0 ? formatCompactNumber(row.original.totalTokens) : <span className="text-[var(--text-faint)]">—</span>}
      </div>
    ),
  },
  {
    accessorKey: "lastActiveAt",
    header: ({ column }) => <SortableHeader column={column} label="Last active" />,
    sortUndefined: "last",
    cell: ({ row }) =>
      row.original.lastActiveAt ? (
        <span className="text-xs">{formatDate(row.original.lastActiveAt)}</span>
      ) : (
        <span className="text-[var(--text-faint)]">—</span>
      ),
  },
];

export function PeopleUsageTable({ rows, rangeKey }: { rows: PersonUsageTableRow[]; rangeKey: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => downloadCsv(rows, `usage-by-person-${rangeKey}-${new Date().toISOString().slice(0, 10)}.csv`)}
          disabled={rows.length === 0}
        >
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Download CSV
        </Button>
      </div>
      <DataTable columns={columns} data={rows} searchKey="person" searchPlaceholder="Search by name, email, or department…" pageSize={25} />
    </div>
  );
}
