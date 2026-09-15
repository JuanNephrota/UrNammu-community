"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileBarChart2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// "Save as report" — creates a private ReportDefinition from the Usage by
// Person template so the view can be exported (PDF/CSV/JSON) and scheduled.
// Only rendered for roles that may author reports.
export function PeopleReportButton({
  template,
}: {
  template: {
    key: string;
    name: string;
    description: string;
    dataSource: string;
    config: Record<string, unknown>;
  };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: template.name,
          description: template.description,
          dataSource: template.dataSource,
          templateKey: template.key,
          config: template.config,
          visibility: "PRIVATE",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not create report");
      router.push(`/reports/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create report");
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-[var(--critical)]">{error}</span>}
      <Button variant="outline" size="sm" onClick={create} disabled={busy}>
        {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileBarChart2 className="mr-1.5 h-3.5 w-3.5" />}
        Save as report
      </Button>
    </div>
  );
}
