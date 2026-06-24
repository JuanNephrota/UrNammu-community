"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ShieldCheck,
  RefreshCw,
  Loader2,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MinusCircle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";

type CheckStatus = "pass" | "warn" | "fail" | "not_applicable";
type Verification = "verified" | "attested" | "inferred";

type Check = {
  id: string;
  dimension: string;
  title: string;
  status: CheckStatus;
  severity: string;
  verification: Verification;
  detail: string;
  remediation?: string;
  evidence?: string;
};

type Result = {
  id: string;
  provider: string;
  overallScore: number;
  grade: string;
  dataHandlingScore: number;
  retentionScore: number;
  trainingUseScore: number;
  encryptionScore: number;
  accessControlScore: number;
  residencyScore: number;
  liveChecksRan: boolean;
  checks: Check[];
};

type Scan = {
  id: string;
  status: string;
  providersScanned: number;
  findingsFound: number;
  criticalCount: number;
  errorMessage: string | null;
  completedAt: string | null;
  createdAt: string;
  results: Result[];
};

const DIMENSIONS: { key: keyof Result; label: string }[] = [
  { key: "dataHandlingScore", label: "Data Handling" },
  { key: "trainingUseScore", label: "Training & Use" },
  { key: "retentionScore", label: "Retention" },
  { key: "residencyScore", label: "Residency" },
  { key: "encryptionScore", label: "Encryption" },
  { key: "accessControlScore", label: "Access Control" },
];

function gradeVariant(grade: string) {
  if (grade === "A" || grade === "B") return "success" as const;
  if (grade === "C") return "warning" as const;
  return "critical" as const;
}

function statusIcon(status: CheckStatus) {
  switch (status) {
    case "pass":
      return <CheckCircle2 className="h-4 w-4 text-[var(--success-strong)]" />;
    case "warn":
      return <AlertTriangle className="h-4 w-4 text-[var(--warning-strong)]" />;
    case "fail":
      return <XCircle className="h-4 w-4 text-[var(--critical-strong)]" />;
    default:
      return <MinusCircle className="h-4 w-4 text-[var(--text-faint)]" />;
  }
}

function verificationVariant(v: Verification) {
  if (v === "verified") return "info" as const;
  if (v === "attested") return "default" as const;
  return "outline" as const;
}

function scoreColor(score: number) {
  if (score < 0) return "var(--text-faint)";
  if (score >= 80) return "var(--success-strong)";
  if (score >= 60) return "var(--warning-strong)";
  return "var(--critical-strong)";
}

export default function ProviderSecurityPage() {
  const [scan, setScan] = useState<Scan | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/provider-security");
      const data = await res.json();
      setScan(data.lastScan ?? null);
    } catch {
      setError("Failed to load scan results.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runScan = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/provider-security", { method: "POST" });
      if (res.status === 409) {
        setError("A scan is already in progress.");
        return;
      }
      if (!res.ok) {
        setError("Scan failed to run.");
        return;
      }
      await load();
    } catch {
      setError("Scan failed to run.");
    } finally {
      setRunning(false);
    }
  };

  const results = scan?.results ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Provider Security & Privacy Scan"
        description="Audits each configured AI provider's secure-use and privacy configuration — credentials, encryption, data retention, training-on-data, residency, and vendor governance."
      >
        <Button onClick={runScan} disabled={running}>
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {running ? "Scanning…" : "Run scan"}
        </Button>
      </PageHeader>

      {error && (
        <div className="rounded-md border border-[var(--critical-border)] bg-[var(--critical-dim)] px-4 py-3 text-sm text-[var(--critical-strong)]">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              Providers Scanned
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {scan?.providersScanned ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              Open Findings
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {scan?.findingsFound ?? 0}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Failing checks across providers
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              High / Critical
            </p>
            <p className="mt-2 text-3xl font-semibold text-[var(--critical-strong)]">
              {scan?.criticalCount ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              Last Scan
            </p>
            <p className="mt-2 text-sm font-medium">
              {scan?.completedAt
                ? formatDateTime(scan.completedAt)
                : scan
                  ? "In progress…"
                  : "Never"}
            </p>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : results.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <ShieldCheck className="h-10 w-10 text-[var(--text-faint)]" />
            <p className="text-sm text-[var(--text-muted)]">
              No scan yet. Run a scan to audit your configured providers. Only
              providers with credentials in Settings &gt; Provider Admin APIs are
              evaluated.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {results.map((r) => {
            const isOpen = expanded[r.id];
            return (
              <Card key={r.id}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <Badge variant={gradeVariant(r.grade)}>{r.grade}</Badge>
                      <CardTitle className="capitalize">{r.provider}</CardTitle>
                      {r.liveChecksRan && (
                        <Badge variant="info">Live-verified</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className="text-2xl font-semibold"
                        style={{ color: scoreColor(r.overallScore) }}
                      >
                        {r.overallScore}
                      </span>
                      <span className="text-xs text-[var(--text-faint)]">/ 100</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {DIMENSIONS.map((d) => {
                      const value = r[d.key] as number;
                      const na = value < 0;
                      return (
                        <div key={d.label}>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-[var(--text-muted)]">{d.label}</span>
                            <span style={{ color: scoreColor(value) }}>
                              {na ? "N/A" : value}
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 w-full rounded-full bg-[var(--bg-elevated)]">
                            <div
                              className="h-1.5 rounded-full"
                              style={{
                                width: na ? "0%" : `${value}%`,
                                backgroundColor: scoreColor(value),
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <button
                    onClick={() =>
                      setExpanded((e) => ({ ...e, [r.id]: !e[r.id] }))
                    }
                    className="flex items-center gap-1 text-xs font-medium text-[var(--accent)]"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    />
                    {isOpen ? "Hide" : "Show"} {r.checks.length} checks
                  </button>

                  {isOpen && (
                    <div className="space-y-2 border-t border-[var(--border-subtle)] pt-3">
                      {r.checks.map((c) => (
                        <div
                          key={c.id}
                          className="flex gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
                        >
                          <div className="mt-0.5">{statusIcon(c.status)}</div>
                          <div className="flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">{c.title}</span>
                              <Badge variant={verificationVariant(c.verification)}>
                                {c.verification}
                              </Badge>
                              {c.status === "fail" && (
                                <Badge
                                  variant={
                                    c.severity === "CRITICAL" ? "critical" : "high"
                                  }
                                >
                                  {c.severity}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-[var(--text-muted)]">
                              {c.detail}
                            </p>
                            {c.remediation && (
                              <p className="text-xs text-[var(--text-secondary)]">
                                <span className="font-medium">Fix: </span>
                                {c.remediation}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
