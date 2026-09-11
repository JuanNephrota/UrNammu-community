"use client";

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, riskBadgeVariant } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type Gap = {
  requirement: string;
  gap: string;
  remediation: string;
  priority: "HIGH" | "MEDIUM" | "LOW" | string;
};

type Result = {
  gaps: Gap[];
  overallAssessment: string;
  complianceScore: number;
};

/**
 * Calls the AI gap-analysis endpoint with the framework's current control
 * statuses and shows the result in a dialog. Advisory only — nothing is
 * persisted; the officer records their own assessment per control.
 */
export function FrameworkGapAnalysisButton({
  systemName,
  frameworkLabel,
  mappings,
}: {
  systemName: string;
  frameworkLabel: string;
  mappings: Array<{ requirement: string; status: string }>;
}) {
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemName, framework: frameworkLabel, currentMappings: mappings }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Analysis failed (${res.status})`);
      setResult({
        gaps: Array.isArray(data.gaps) ? data.gaps : [],
        overallAssessment: typeof data.overallAssessment === "string" ? data.overallAssessment : "",
        complianceScore: Number.isFinite(Number(data.complianceScore)) ? Number(data.complianceScore) : 0,
      });
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={run} disabled={loading || mappings.length === 0}>
        {loading ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1.5 h-3 w-3" />}
        {loading ? "Analysing..." : "AI Gap Analysis"}
      </Button>
      {error && <p className="max-w-[240px] text-right text-[11px] text-[var(--critical)]">{error}</p>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Gap analysis — {frameworkLabel}</DialogTitle>
            <DialogDescription>
              {systemName}. Advisory output from the configured AI provider; record your own
              assessment per control.
            </DialogDescription>
          </DialogHeader>
          {result && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
                <div
                  className="text-2xl font-bold"
                  style={{
                    fontFamily: "var(--font-display)",
                    color:
                      result.complianceScore >= 75
                        ? "var(--success)"
                        : result.complianceScore >= 50
                          ? "var(--warning)"
                          : "var(--critical)",
                  }}
                >
                  {Math.round(result.complianceScore)}
                </div>
                <p className="text-sm text-[var(--text-secondary)]">{result.overallAssessment}</p>
              </div>
              {result.gaps.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No gaps identified.</p>
              ) : (
                <div className="space-y-2">
                  {result.gaps.map((gap, i) => (
                    <div key={i} className="rounded-md border border-[var(--border-subtle)] p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={riskBadgeVariant(String(gap.priority).toUpperCase())}>
                          {String(gap.priority).toUpperCase()}
                        </Badge>
                        <p className="text-sm font-medium text-[var(--text-primary)]">{gap.requirement}</p>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">{gap.gap}</p>
                      {gap.remediation && (
                        <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                          Remediation: {gap.remediation}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
