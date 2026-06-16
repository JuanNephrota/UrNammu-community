"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ShieldAlert,
  FileCheck,
  DollarSign,
  Search,
  Database,
  Presentation,
  Bell,
  ScrollText,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { ReportTemplate } from "@/lib/reports/templates";

const ICONS: Record<string, LucideIcon> = {
  ShieldAlert,
  FileCheck,
  DollarSign,
  Search,
  Database,
  Presentation,
  Bell,
  ScrollText,
};

export function TemplateGallery({
  templates,
  canCreate,
}: {
  templates: ReportTemplate[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createFromTemplate(template: ReportTemplate) {
    if (!canCreate) return;
    setBusy(template.key);
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
      router.push(`/reports/${data.id}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create report");
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-[var(--critical-strong)]">{error}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {templates.map((template) => {
          const Icon = ICONS[template.icon] ?? Database;
          return (
            <button
              key={template.key}
              type="button"
              disabled={!canCreate || busy !== null}
              onClick={() => createFromTemplate(template)}
              className="text-left disabled:cursor-not-allowed disabled:opacity-60"
              title={canCreate ? "Create a report from this template" : "Requires author role"}
            >
              <Card className="group h-full transition-all hover:border-[var(--accent-border)] hover:shadow-[0_0_0_1px_var(--accent-border)]">
                <CardContent className="flex h-full flex-col gap-3 p-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-dim)] text-[var(--accent)]">
                    {busy === template.key ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Icon className="h-5 w-5" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                      {template.name}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                      {template.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>
    </div>
  );
}
