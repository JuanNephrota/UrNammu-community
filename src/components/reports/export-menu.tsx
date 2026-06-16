"use client";

import { useState } from "react";
import { Download, FileText, FileJson, Sheet, Loader2, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { ReportFormatKey } from "@/lib/reports/types";

const FORMATS: { key: ReportFormatKey; label: string; icon: typeof FileText }[] = [
  { key: "PDF", label: "PDF document", icon: FileText },
  { key: "CSV", label: "CSV (Excel)", icon: Sheet },
  { key: "JSON", label: "JSON", icon: FileJson },
];

export function ExportMenu({ reportId }: { reportId: string }) {
  const [busy, setBusy] = useState<ReportFormatKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function exportAs(format: ReportFormatKey) {
    setBusy(format);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${reportId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="(.+?)"/);
      const filename = match?.[1] ?? `report.${format.toLowerCase()}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="default" disabled={busy !== null}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {FORMATS.map((f) => (
            <DropdownMenuItem
              key={f.key}
              onSelect={(e) => {
                e.preventDefault();
                exportAs(f.key);
              }}
              className="cursor-pointer gap-2"
            >
              <f.icon className="h-4 w-4 text-[var(--text-muted)]" />
              {f.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && <span className="text-xs text-[var(--critical-strong)]">{error}</span>}
    </div>
  );
}
