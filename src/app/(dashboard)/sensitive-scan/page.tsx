"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ScanSearch,
  RefreshCw,
  Loader2,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  MessageSquareText,
} from "lucide-react";
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

type ProbeResult = {
  id: string;
  targetId: string;
  targetLabel: string;
  model: string | null;
  probeId: string;
  probeLabel: string;
  status: string; // probed | error
  responseExcerpt: string | null;
  responseLength: number;
  flagged: boolean;
  severity: string | null;
  categories: string[];
  findingId: string | null;
  errorMessage: string | null;
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
  probeResults?: ProbeResult[];
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

function groupByTarget(results: ProbeResult[]): Array<{ key: string; label: string; model: string | null; items: ProbeResult[] }> {
  const groups = new Map<string, { key: string; label: string; model: string | null; items: ProbeResult[] }>();
  for (const r of results) {
    const g = groups.get(r.targetId) ?? { key: r.targetId, label: r.targetLabel, model: r.model, items: [] };
    g.items.push(r);
    groups.set(r.targetId, g);
  }
  return [...groups.values()];
}

const RESPONSE_PREVIEW_CHARS = 400;

/** One probe's answer: label, verdict, and the sanitized response text. */
function ProbeResponse({ result }: { result: ProbeResult }) {
  const [expanded, setExpanded] = useState(false);
  const text = result.responseExcerpt ?? "";
  const long = text.length > RESPONSE_PREVIEW_CHARS;
  const shown = expanded || !long ? text : `${text.slice(0, RESPONSE_PREVIEW_CHARS)}…`;

  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-[var(--text-primary)]">{result.probeLabel}</span>
        {result.status === "error" ? (
          <Badge variant="high">error</Badge>
        ) : result.flagged ? (
          <Badge variant={severityVariant(result.severity ?? "warning")}>
            leaked · {result.severity ?? "warning"}
          </Badge>
        ) : (
          <Badge variant="success">clean</Badge>
        )}
        {result.status === "probed" && (
          <span className="ml-auto text-xs text-[var(--text-muted)]">
            {result.responseLength.toLocaleString()} chars
          </span>
        )}
      </div>
      {result.flagged && result.categories.length > 0 && (
        <p className="mt-1 text-xs text-[var(--text-secondary)]">{result.categories.join(", ")}</p>
      )}
      {result.status === "error" ? (
        <p className="mt-2 text-xs text-[var(--critical-strong)]">
          {result.errorMessage ?? "Probe request failed"}
        </p>
      ) : text ? (
        <>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[var(--text-secondary)]">
            {shown}
          </pre>
          {long && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-xs text-[var(--accent)] hover:underline"
            >
              {expanded ? "Show less" : "Show full response"}
            </button>
          )}
        </>
      ) : (
        <p className="mt-2 text-xs italic text-[var(--text-muted)]">(empty response)</p>
      )}
    </div>
  );
}

/** Everything the models said during one scan, grouped by target. */
function ScanResponses({ results }: { results: ProbeResult[] }) {
  if (results.length === 0) {
    return (
      <p className="py-3 text-xs text-[var(--text-muted)]">
        No probe responses were recorded for this scan (it ran before response history was kept, or no target was probed).
      </p>
    );
  }
  return (
    <div className="space-y-4 py-3">
      <p className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
        <MessageSquareText className="h-3.5 w-3.5" />
        Responses are stored redacted — emails, tokens, card and SSN shapes and long numbers are replaced with placeholders.
      </p>
      {groupByTarget(results).map((g) => (
        <div key={g.key} className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-primary)]">{g.label}</span>
            {g.model && <span className="text-xs text-[var(--text-muted)]">{g.model}</span>}
          </div>
          <div className="space-y-2">
            {g.items.map((r) => (
              <ProbeResponse key={r.id} result={r} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SensitiveScanPage() {
  const [scans, setScans] = useState<ScanRow[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [targets, setTargets] = useState<TargetResult[]>([]);
  const [openScanId, setOpenScanId] = useState<string | null>(null);

  const fetchData = useCallback(async (): Promise<ScanRow[]> => {
    const res = await fetch("/api/sensitive-scan");
    if (!res.ok) return [];
    const data = await res.json();
    const rows: ScanRow[] = data.recentScans ?? [];
    setScans(rows);
    setFindings(data.findings ?? []);
    return rows;
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
      // Open the scan that just ran so its responses are one glance away.
      const rows = await fetchData();
      if (rows[0]) setOpenScanId(rows[0].id);
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
            <div className="space-y-1">
              {scans.map((s) => {
                const open = openScanId === s.id;
                const responses = s.probeResults ?? [];
                return (
                  <div key={s.id} className="border-b border-[var(--border-subtle)] last:border-0">
                    <button
                      type="button"
                      onClick={() => setOpenScanId(open ? null : s.id)}
                      aria-expanded={open}
                      className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm hover:bg-[var(--bg-surface)]"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {open ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                        )}
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
                          {responses.length > 0
                            ? ` · ${responses.length} response${responses.length === 1 ? "" : "s"}`
                            : ""}
                        </span>
                        {s.errorMessage && (
                          <span className="truncate text-xs text-[var(--critical-strong)]">
                            {s.errorMessage}
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-[var(--text-muted)]">
                        {timeAgo(s.completedAt ?? s.createdAt)}
                      </span>
                    </button>
                    {open && (
                      <div className="pl-6">
                        <ScanResponses results={responses} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
