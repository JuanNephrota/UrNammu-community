"use client";

import { useState, useEffect, useCallback } from "react";
import { ScanSearch, RefreshCw, Loader2, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Finding = {
  id: string;
  source: string;
  provider: string;
  model: string | null;
  probeLabel: string | null;
  severity: string;
  categories: string[];
  matchedSignals: string[];
  excerpt: string | null;
  createdAt: string;
};

type ScanRow = {
  id: string;
  status: string;
  targetsProbed: number;
  findingsFound: number;
  criticalCount: number;
  errorMessage: string | null;
  completedAt: string | null;
  createdAt: string;
};

type TargetResult = {
  id: string;
  label: string;
  status: string;
  model: string | null;
  findings: number;
  reason?: string;
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function severityVariant(sev: string): "critical" | "warning" {
  return sev === "critical" ? "critical" : "warning";
}

export default function SensitiveScanPage() {
  const [scans, setScans] = useState<ScanRow[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [targets, setTargets] = useState<TargetResult[]>([]);

  const fetchData = useCallback(async () => {
    const res = await fetch("/api/sensitive-scan");
    if (res.ok) {
      const data = await res.json();
      setScans(data.recentScans ?? []);
      setFindings(data.findings ?? []);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleScan() {
    setScanning(true);
    setMessage(null);
    setTargets([]);
    try {
      const res = await fetch("/api/sensitive-scan", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTargets(data.targets ?? []);
        setMessage(
          `Scan complete — ${data.targetsProbed} provider(s) probed, ${data.findingsFound} finding(s) (${data.criticalCount} critical).`
        );
      } else {
        setMessage(data.error ?? "Scan failed.");
      }
    } catch {
      setMessage("Scan failed — network error.");
    } finally {
      setScanning(false);
      fetchData();
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sensitive Scan"
        description="Probe reachable AI endpoints for data leakage and review sensitive information detected in model responses."
      >
        <Button onClick={handleScan} disabled={scanning}>
          {scanning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {scanning ? "Probing…" : "Run scan"}
        </Button>
      </PageHeader>

      {message && (
        <Card>
          <CardContent className="py-4 text-sm text-[var(--text-secondary)]">
            {message}
          </CardContent>
        </Card>
      )}

      {targets.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Probe targets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {targets.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-2 last:border-0"
              >
                <div>
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    {t.label}
                  </span>
                  {t.reason && (
                    <p className="text-xs text-[var(--text-muted)]">{t.reason}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {t.model && (
                    <span className="text-xs text-[var(--text-muted)]">{t.model}</span>
                  )}
                  <Badge
                    variant={
                      t.status === "probed"
                        ? t.findings > 0
                          ? "critical"
                          : "success"
                        : t.status === "error"
                          ? "high"
                          : "outline"
                    }
                  >
                    {t.status === "probed"
                      ? `${t.findings} finding${t.findings === 1 ? "" : "s"}`
                      : t.status}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[var(--accent)]" />
            Recent findings
          </CardTitle>
        </CardHeader>
        <CardContent>
          {findings.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--text-muted)]">
              No sensitive information detected yet. Run a scan to probe configured AI tools.
            </p>
          ) : (
            <div className="space-y-3">
              {findings.map((f) => (
                <div
                  key={f.id}
                  className="rounded-lg border border-[var(--border-subtle)] p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={severityVariant(f.severity)}>{f.severity}</Badge>
                    <Badge variant="outline">
                      {f.source === "probe" ? "Leakage probe" : "Response DLP"}
                    </Badge>
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {f.provider}
                      {f.model ? ` · ${f.model}` : ""}
                    </span>
                    {f.probeLabel && (
                      <span className="text-xs text-[var(--text-muted)]">{f.probeLabel}</span>
                    )}
                    <span className="ml-auto text-xs text-[var(--text-muted)]">
                      {timeAgo(f.createdAt)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-[var(--text-secondary)]">
                    {f.categories.join(", ")}
                  </p>
                  {f.excerpt && (
                    <p className="mt-1 font-mono text-xs text-[var(--text-muted)]">
                      {f.excerpt}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScanSearch className="h-4 w-4 text-[var(--accent)]" />
            Scan history
          </CardTitle>
        </CardHeader>
        <CardContent>
          {scans.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--text-muted)]">
              No scans yet.
            </p>
          ) : (
            <div className="space-y-2">
              {scans.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-2 text-sm last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        s.status === "completed"
                          ? "success"
                          : s.status === "failed"
                            ? "critical"
                            : "warning"
                      }
                    >
                      {s.status}
                    </Badge>
                    <span className="text-[var(--text-secondary)]">
                      {s.targetsProbed} probed · {s.findingsFound} finding(s)
                      {s.criticalCount > 0 ? ` · ${s.criticalCount} critical` : ""}
                    </span>
                    {s.errorMessage && (
                      <span className="text-xs text-[var(--critical-strong)]">
                        {s.errorMessage}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-[var(--text-muted)]">
                    {timeAgo(s.completedAt ?? s.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
