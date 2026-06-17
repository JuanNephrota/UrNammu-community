"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Shield, RefreshCw, Loader2, Wifi, Clock, Upload } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DNS_PROXY_IMPORT_SOURCES } from "@/lib/discovered-tools-ingest";

type Tool = {
  id: string;
  toolName: string;
  vendor: string | null;
  detectedDomain: string | null;
  detectionSource: string;
  status: string;
  department: string | null;
  userCount: number;
  notes: string | null;
  detectedAt: string;
  linkedSystemId?: string | null;
  matchConfidence?: string | null;
  matchScore?: number | null;
  matchReasons?: string[] | null;
};

type ScanStatus = {
  configured: boolean;
  lastScan: ScanHistorySummary | null;
  sources?: {
    googleWorkspace: {
      configured: boolean;
      lastScan: ScanHistorySummary | null;
    };
    microsoft365: {
      configured: boolean;
      lastScan: ScanHistorySummary | null;
    };
    hexnode: {
      configured: boolean;
      lastScan: ScanHistorySummary | null;
    };
  };
};

type ScanHistorySummary = {
    id: string;
    scanType: string;
    status: string;
    toolsFound: number;
    newToolsAdded: number;
    updatedTools: number;
    completedAt: string | null;
    errorMessage: string | null;
};

type IngestionRun = {
  id: string;
  source: string;
  status: string;
  inputType: string;
  fileName: string | null;
  processed: number;
  matched: number;
  newTools: number;
  updatedTools: number;
  errorMessage: string | null;
  createdAt: string;
};

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function ShadowAIPage() {
  const router = useRouter();
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  // Tracks which tool is currently in-flight for a register action so we can
  // disable its buttons and surface "Classifying..." feedback — AI
  // classification on the server can add several seconds of latency.
  const [pendingRegisterId, setPendingRegisterId] = useState<string | null>(null);
  const [ingestionRuns, setIngestionRuns] = useState<IngestionRun[]>([]);

  const fetchTools = useCallback(() => {
    fetch("/api/discovered-tools")
      .then((r) => r.json())
      .then(setTools)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchTools();
    // Fetch scan status
    fetch("/api/discovered-tools/scan")
      .then((r) => r.json())
      .then(setScanStatus)
      .catch((err) => console.error("Failed to fetch scan status:", err));
    fetch("/api/discovered-tools/ingest?take=10")
      .then((r) => r.json())
      .then(setIngestionRuns)
      .catch((err) => console.error("Failed to fetch ingestion runs:", err));
  }, [fetchTools]);

  // Scan every configured provider in turn. The scan endpoint runs one
  // provider per request and rejects with 409 while another scan is in
  // progress, so providers must be scanned sequentially rather than in
  // parallel.
  async function handleScanAll() {
    const sources = scanStatus?.sources;
    const providers: { id: "google_workspace" | "microsoft_365" | "hexnode"; label: string }[] = [];
    if (sources?.googleWorkspace.configured)
      providers.push({ id: "google_workspace", label: "Google Workspace" });
    if (sources?.microsoft365.configured)
      providers.push({ id: "microsoft_365", label: "Microsoft 365" });
    if (sources?.hexnode.configured)
      providers.push({ id: "hexnode", label: "Hexnode" });

    if (providers.length === 0) {
      setScanResult(
        "No sources configured. Connect Google Workspace, Microsoft 365, or Hexnode in Settings > Shadow AI."
      );
      return;
    }

    setScanning(true);
    const summaries: string[] = [];
    try {
      for (const provider of providers) {
        setScanResult(
          `Scanning ${provider.label}${
            providers.length > 1
              ? ` (${providers.indexOf(provider) + 1}/${providers.length})`
              : ""
          }...`
        );
        try {
          const res = await fetch("/api/discovered-tools/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: provider.id }),
          });
          const data = await res.json();

          if (res.ok && data.status === "completed") {
            summaries.push(
              `${provider.label}: ${data.toolsFound} found, ${data.newToolsAdded} new, ${data.updatedTools} updated`
            );
          } else if (res.ok && data.status === "failed") {
            summaries.push(
              `${provider.label}: failed (${data.errorMessage ?? "unknown error"})`
            );
          } else {
            summaries.push(
              `${provider.label}: failed (${data.error ?? data.status ?? "unknown error"})`
            );
          }
        } catch {
          summaries.push(`${provider.label}: timed out or network error`);
        }
      }

      setScanResult(`Scan complete — ${summaries.join("; ")}.`);
      fetchTools();
      // Refresh scan status after all providers finish.
      const statusRes = await fetch("/api/discovered-tools/scan");
      if (statusRes.ok) setScanStatus(await statusRes.json());
    } finally {
      setScanning(false);
    }
  }

  const configuredSourceCount = scanStatus?.sources
    ? [
        scanStatus.sources.googleWorkspace.configured,
        scanStatus.sources.microsoft365.configured,
        scanStatus.sources.hexnode.configured,
      ].filter(Boolean).length
    : 0;

  function sourceBadgeLabel(source: string) {
    if (source === "google_workspace") return "GOOGLE";
    if (source === "microsoft_365") return "MICROSOFT";
    return source.replace(/_/g, " ").toUpperCase();
  }

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    const data = {
      toolName: fd.get("toolName") as string,
      vendor: fd.get("vendor") as string,
      detectedDomain: fd.get("detectedDomain") as string,
      detectionSource: fd.get("detectionSource") as string,
      department: fd.get("department") as string,
      userCount: parseInt(fd.get("userCount") as string) || 0,
      notes: fd.get("notes") as string,
    };
    const res = await fetch("/api/discovered-tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const tool = await res.json();
      setTools((prev) => [tool, ...prev]);
      setShowAdd(false);
    }
    setSubmitting(false);
  }

  // Navigate to the full conversion form while surfacing the same
  // "Analyzing..." banner users see for Register & Assess. The /registry/new
  // page awaits the AI classifier server-side, so the browser sits on the
  // Shadow AI page for a few seconds before the new page renders — without
  // feedback the button feels unresponsive.
  function handleConvert(id: string) {
    setPendingRegisterId(id);
    router.push(`/registry/new?discoveredToolId=${id}`);
  }

  async function handleAction(id: string, action: string) {
    const isRegister = action === "register" || action === "register_and_assess";
    if (isRegister) setPendingRegisterId(id);
    try {
      const res = await fetch(`/api/discovered-tools/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isRegister ? { action } : { status: action }),
      });
      if (res.ok) {
        const data = await res.json();
        setTools((prev) =>
          prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status: isRegister ? "REGISTERED" : action,
                  linkedSystemId: data.tool?.linkedSystemId ?? t.linkedSystemId,
                }
              : t
          )
        );
        if (isRegister) {
          if (data.nextHref) router.push(data.nextHref);
          router.refresh();
        }
      }
    } finally {
      if (isRegister) setPendingRegisterId(null);
    }
  }

  async function handleImportCSV(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setImporting(true);
    setImportResult(null);

    const formData = new FormData(e.currentTarget);
    const file = formData.get("csvFile") as File;
    const source = formData.get("source") as string || "dns_proxy";

    if (!file) {
      setImportResult("No file selected");
      setImporting(false);
      return;
    }

    try {
      const upload = new FormData();
      upload.set("source", source);
      upload.set("file", file);

      const res = await fetch("/api/discovered-tools/import", {
        method: "POST",
        body: upload,
      });

      const data = await res.json();
      if (res.ok) {
        setImportResult(
          `Processed ${data.processed} entries: ${data.matched} AI tools matched, ${data.newTools} new, ${data.updatedTools} updated.`
        );
        fetchTools();
        fetch("/api/discovered-tools/ingest?take=10")
          .then((r) => r.json())
          .then(setIngestionRuns)
          .catch(() => {});
        if (data.newTools > 0) setShowImport(false);
      } else {
        setImportResult(`Import failed: ${data.error}`);
      }
    } catch (err) {
      setImportResult(`Import failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setImporting(false);
    }
  }

  const [dismissReason, setDismissReason] = useState("");
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissedCount, setDismissedCount] = useState(0);

  // Fetch dismissed count on mount
  useEffect(() => {
    fetch("/api/discovered-tools/dismissed")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setDismissedCount(data.length); })
      .catch(() => {});
  }, []);

  const allDiscovered = tools.filter((t) => t.status === "DISCOVERED" || t.status === "UNDER_REVIEW");
  // High-confidence = no matchConfidence set (legacy/manual) or "high"
  const discovered = allDiscovered.filter((t) => !t.matchConfidence || t.matchConfidence === "high");
  // Low/medium confidence candidates for review queue
  const lowConfidenceCandidates = allDiscovered.filter((t) => t.matchConfidence === "low" || t.matchConfidence === "medium");
  const resolved = tools.filter((t) => !["DISCOVERED", "UNDER_REVIEW"].includes(t.status));

  async function handlePromote(id: string) {
    const res = await fetch(`/api/discovered-tools/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "promote" }),
    });
    if (res.ok) fetchTools();
  }

  async function handleDismiss(id: string) {
    if (!dismissReason.trim()) return;
    const res = await fetch(`/api/discovered-tools/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss_candidate", reason: dismissReason.trim() }),
    });
    if (res.ok) {
      setDismissingId(null);
      setDismissReason("");
      setDismissedCount((c) => c + 1);
      fetchTools();
    }
  }

  const pendingTool = pendingRegisterId
    ? tools.find((t) => t.id === pendingRegisterId) ?? null
    : null;

  return (
    <div className="space-y-6">
      {pendingTool && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-[var(--accent)]/40 bg-[var(--bg-surface)] p-4 shadow-[0_10px_40px_rgba(0,0,0,0.4)]"
        >
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[var(--accent)]" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              Analyzing {pendingTool.toolName}
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              The AI assistant is inferring use case, data inputs &amp; outputs,
              risk level, and sensitivity. This usually takes a few seconds.
            </p>
          </div>
        </div>
      )}
      <PageHeader
        title="Shadow AI Discovery"
        description="Detect and manage unauthorized AI tool usage"
      >
        <Button
          onClick={handleScanAll}
          disabled={scanning || configuredSourceCount === 0}
          variant="outline"
          className="gap-2"
          title={
            configuredSourceCount === 0
              ? "Connect a source in Settings > Shadow AI to enable scanning"
              : `Scan all ${configuredSourceCount} configured source(s)`
          }
        >
          {scanning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {scanning
            ? "Scanning..."
            : configuredSourceCount > 0
              ? `Scan All Sources (${configuredSourceCount})`
              : "Scan All Sources"}
        </Button>
        <Button variant="ghost" asChild>
          <Link href="/settings/shadow-ai">Shadow AI Settings</Link>
        </Button>
        <Dialog open={showImport} onOpenChange={(v) => { setShowImport(v); if (!v) setImportResult(null); }}>
          <DialogTrigger asChild>
            <Button variant="outline" className="gap-2">
              <Upload className="h-4 w-4" />
              Import Logs
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Import DNS / Proxy Logs</DialogTitle>
              <DialogDescription>
                Upload a CSV or text file containing domain access logs. AI tool domains will be automatically detected.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleImportCSV} className="space-y-4">
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Accepted Formats</p>
                <div className="text-xs text-[var(--text-muted)] space-y-1">
                  <p><span className="font-medium text-[var(--text-primary)]">Plain text</span> — one domain per line</p>
                  <p><span className="font-medium text-[var(--text-primary)]">CSV with headers</span> — generic logs should include <code className="bg-[var(--bg-elevated)] px-1 rounded">domain</code> plus optional <code className="bg-[var(--bg-elevated)] px-1 rounded">user</code>, <code className="bg-[var(--bg-elevated)] px-1 rounded">department</code>, and <code className="bg-[var(--bg-elevated)] px-1 rounded">count</code></p>
                  <p><span className="font-medium text-[var(--text-primary)]">Vendor presets</span> — Cisco Umbrella, Cloudflare Gateway, Zscaler, Netskope, Prisma Access, DNSFilter, NextDNS</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Log File (.csv, .txt, .log)</Label>
                <Input name="csvFile" type="file" accept=".csv,.txt,.log,.tsv" required className="file:mr-3 file:rounded-md file:border-0 file:bg-[var(--bg-elevated)] file:px-3 file:py-1 file:text-xs file:text-[var(--text-secondary)]" />
              </div>
              <div className="space-y-2">
                <Label>Source</Label>
                <select name="source" defaultValue="dns_proxy" className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none">
                  {DNS_PROXY_IMPORT_SOURCES.map((source) => (
                    <option key={source.id} value={source.id}>{source.label}</option>
                  ))}
                </select>
                <p className="text-[11px] text-[var(--text-faint)]">
                  Choose the closest export type so we can map vendor-specific headers before matching AI domains.
                </p>
              </div>
              {importResult && (
                <p className={`text-xs font-medium ${importResult.includes("failed") ? "text-[var(--critical)]" : "text-[var(--success)]"}`}>
                  {importResult}
                </p>
              )}
              <Button type="submit" disabled={importing} className="w-full bg-[var(--accent)] text-[var(--bg-deep)] hover:brightness-110">
                {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                {importing ? "Processing..." : "Upload & Analyze"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button className="bg-[var(--accent)] text-[var(--bg-deep)] hover:brightness-110">
              <Plus className="mr-2 h-4 w-4" /> Report Tool
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Report Discovered AI Tool</DialogTitle>
              <DialogDescription>Add an AI tool detected in your organization</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Tool Name *</Label>
                  <Input name="toolName" required />
                </div>
                <div className="space-y-1">
                  <Label>Vendor</Label>
                  <Input name="vendor" />
                </div>
                <div className="space-y-1">
                  <Label>Domain</Label>
                  <Input name="detectedDomain" placeholder="e.g. chat.openai.com" />
                </div>
                <div className="space-y-1">
                  <Label>Detection Source</Label>
                  <select name="detectionSource" defaultValue="manual" className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none">
                    <option value="manual">Manual</option>
                    <option value="network_log">Network Log</option>
                    <option value="siem">SIEM</option>
                    <option value="browser_extension">Browser Extension</option>
                    <option value="google_workspace">Google Workspace</option>
                    <option value="microsoft_365">Microsoft 365</option>
                    <option value="hexnode">Hexnode</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Department</Label>
                  <Input name="department" />
                </div>
                <div className="space-y-1">
                  <Label>User Count</Label>
                  <Input name="userCount" type="number" defaultValue="0" />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Input name="notes" />
              </div>
              <Button type="submit" disabled={submitting} className="w-full bg-[var(--accent)] text-[var(--bg-deep)] hover:brightness-110">
                {submitting ? "Adding..." : "Add Tool"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </PageHeader>

      {/* Scan status bar */}
      {(scanStatus || scanResult) && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 space-y-2">
          <div className="flex flex-wrap items-center gap-4">
            {scanStatus?.sources?.googleWorkspace.configured ? (
              <div className="flex items-center gap-2 text-xs text-[var(--success)]">
                <Wifi className="h-3.5 w-3.5" />
                <span>Google Workspace connected</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-[var(--text-faint)]">
                <Wifi className="h-3.5 w-3.5" />
                <span>Google Workspace not configured</span>
              </div>
            )}
            {scanStatus?.sources?.microsoft365.configured ? (
              <div className="flex items-center gap-2 text-xs text-[var(--success)]">
                <Wifi className="h-3.5 w-3.5" />
                <span>Microsoft 365 connected</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-[var(--text-faint)]">
                <Wifi className="h-3.5 w-3.5" />
                <span>Microsoft 365 not configured</span>
              </div>
            )}
            {scanStatus?.sources?.hexnode.configured ? (
              <div className="flex items-center gap-2 text-xs text-[var(--success)]">
                <Wifi className="h-3.5 w-3.5" />
                <span>Hexnode connected</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-[var(--text-faint)]">
                <Wifi className="h-3.5 w-3.5" />
                <span>Hexnode not configured</span>
              </div>
            )}
            {scanStatus?.lastScan?.completedAt && (
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <Clock className="h-3.5 w-3.5" />
                <span>
                  Last scan: {timeAgo(scanStatus.lastScan.completedAt)} &mdash;{" "}
                  {scanStatus.lastScan.scanType} &mdash;{" "}
                  {scanStatus.lastScan.status === "completed"
                    ? `${scanStatus.lastScan.toolsFound} tools found, ${scanStatus.lastScan.newToolsAdded} new`
                    : "failed"}
                </span>
              </div>
            )}
            {scanResult && (
              <p className={`text-xs font-medium ${scanResult.includes("failed") || scanResult.includes("error") ? "text-[var(--critical)]" : "text-[var(--success)]"}`}>
                {scanResult}
              </p>
            )}
          </div>
          {scanStatus?.lastScan?.status === "failed" && scanStatus.lastScan.errorMessage && (
            <div className="rounded-md bg-[var(--critical)]/10 px-3 py-2 text-xs text-[var(--critical)]">
              Error: {scanStatus.lastScan.errorMessage}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-[var(--warning)]" style={{ fontFamily: "var(--font-display)" }}>{discovered.length}</p>
            <p className="text-sm text-[var(--text-muted)]">Needs Review</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-[var(--success)]" style={{ fontFamily: "var(--font-display)" }}>{tools.filter((t) => t.status === "REGISTERED" || t.status === "APPROVED").length}</p>
            <p className="text-sm text-[var(--text-muted)]">Approved / Registered</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-[var(--critical)]" style={{ fontFamily: "var(--font-display)" }}>{tools.filter((t) => t.status === "BLOCKED").length}</p>
            <p className="text-sm text-[var(--text-muted)]">Blocked</p>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <p className="text-[var(--text-muted)]">Loading...</p>
      ) : (
        <>
          {discovered.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Needs Review ({discovered.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {discovered.map((tool) => (
                    <div key={tool.id} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{tool.toolName}</p>
                            {(tool.detectionSource === "google_workspace" ||
                              tool.detectionSource === "microsoft_365") && (
                              <Badge variant="info" className="text-[9px] px-1.5">
                                {sourceBadgeLabel(tool.detectionSource)}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-[var(--text-muted)]">
                            {tool.vendor ?? "Unknown vendor"} &middot; {tool.detectedDomain ?? "—"} &middot; {tool.userCount} users
                            {tool.department && ` · ${tool.department}`}
                          </p>
                          <p className="text-xs text-[var(--text-faint)] mt-1">
                            Detected via {tool.detectionSource.replace("_", " ")} on {new Date(tool.detectedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex gap-2 shrink-0 ml-4">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pendingRegisterId === tool.id}
                            onClick={() => handleConvert(tool.id)}
                          >
                            {pendingRegisterId === tool.id ? "Analyzing..." : "Convert to Governed System"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pendingRegisterId === tool.id}
                            onClick={() => handleAction(tool.id, "register_and_assess")}
                          >
                            <Shield className="mr-1 h-3 w-3" />
                            {pendingRegisterId === tool.id ? "Classifying..." : "Register & Assess"}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleAction(tool.id, "APPROVED")}>
                            Approve
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => handleAction(tool.id, "BLOCKED")}>
                            Block
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setDismissingId(dismissingId === tool.id ? null : tool.id);
                              setDismissReason("");
                            }}
                          >
                            Dismiss
                          </Button>
                        </div>
                      </div>
                      {dismissingId === tool.id && (
                        <div className="flex items-center gap-2 pt-1">
                          <Input
                            value={dismissReason}
                            onChange={(e) => setDismissReason(e.target.value)}
                            placeholder="Reason for dismissal (e.g. false positive, approved shadow usage, not an AI tool)..."
                            className="text-xs"
                          />
                          <Button
                            size="sm"
                            onClick={() => handleDismiss(tool.id)}
                            disabled={!dismissReason.trim()}
                          >
                            Confirm
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Low-Confidence Review Queue */}
          {lowConfidenceCandidates.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Low-Confidence Candidates ({lowConfidenceCandidates.length})
                  <Badge variant="warning">Review Queue</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-[var(--text-muted)] mb-3">
                  These tools were detected via AI keyword heuristics but did not match any known tool in the registry with high confidence. Promote confirmed AI tools or dismiss false matches.
                </p>
                <div className="space-y-3">
                  {lowConfidenceCandidates.map((tool) => (
                    <div key={tool.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{tool.toolName}</p>
                          <Badge variant={tool.matchConfidence === "low" ? "warning" : "info"}>
                            {tool.matchConfidence}
                          </Badge>
                          {tool.matchScore != null && (
                            <span className="text-[10px] text-[var(--text-faint)]">Score: {tool.matchScore}</span>
                          )}
                          {(tool.detectionSource === "google_workspace" ||
                            tool.detectionSource === "microsoft_365") && (
                            <Badge variant="info" className="text-[9px] px-1.5">
                              {sourceBadgeLabel(tool.detectionSource)}
                            </Badge>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Button size="sm" variant="outline" onClick={() => handlePromote(tool.id)}>
                            Promote
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => { setDismissingId(dismissingId === tool.id ? null : tool.id); setDismissReason(""); }}
                          >
                            Dismiss
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-[var(--text-muted)]">
                        {tool.vendor ?? "Unknown vendor"} &middot; {tool.detectedDomain ?? "—"} &middot; {tool.userCount} users
                        {tool.department && ` · ${tool.department}`}
                      </p>
                      {tool.matchReasons && tool.matchReasons.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {tool.matchReasons.map((reason) => (
                            <code
                              key={reason}
                              className="rounded bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                            >
                              {reason}
                            </code>
                          ))}
                        </div>
                      )}
                      {dismissingId === tool.id && (
                        <div className="flex items-center gap-2 pt-1">
                          <Input
                            value={dismissReason}
                            onChange={(e) => setDismissReason(e.target.value)}
                            placeholder="Reason for dismissal (e.g. not an AI tool, internal service)..."
                            className="text-xs"
                          />
                          <Button size="sm" onClick={() => handleDismiss(tool.id)} disabled={!dismissReason.trim()}>
                            Confirm
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {resolved.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Resolved ({resolved.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {resolved.map((tool) => (
                    <div key={tool.id} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="text-sm font-medium">{tool.toolName}</p>
                          <p className="text-xs text-[var(--text-muted)]">{tool.vendor ?? "—"} &middot; {tool.department ?? "—"}</p>
                        </div>
                        {(tool.detectionSource === "google_workspace" ||
                          tool.detectionSource === "microsoft_365") && (
                          <Badge variant="info" className="text-[9px] px-1.5">
                            {sourceBadgeLabel(tool.detectionSource)}
                          </Badge>
                        )}
                        {tool.linkedSystemId && (
                          <Button size="sm" variant="ghost" asChild>
                            <Link href={`/registry/${tool.linkedSystemId}`}>View System</Link>
                          </Button>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {!tool.linkedSystemId && tool.status === "APPROVED" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pendingRegisterId === tool.id}
                              onClick={() => handleConvert(tool.id)}
                            >
                              {pendingRegisterId === tool.id ? "Analyzing..." : "Convert to Governed System"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pendingRegisterId === tool.id}
                              onClick={() => handleAction(tool.id, "register_and_assess")}
                            >
                              <Shield className="mr-1 h-3 w-3" />
                              {pendingRegisterId === tool.id ? "Classifying..." : "Register & Assess"}
                            </Button>
                          </>
                        )}
                        {tool.status === "BLOCKED" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleAction(tool.id, "UNDER_REVIEW")}
                          >
                            Unblock
                          </Button>
                        )}
                        <Badge variant={statusBadgeVariant(tool.status)}>{tool.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {ingestionRuns.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Recent Imports</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {ingestionRuns.map((run) => (
                    <div key={run.id} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                      <div>
                        <p className="text-sm font-medium">{run.fileName ?? run.source}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {run.inputType.toUpperCase()} · {run.processed} processed · {run.matched} matched · {run.newTools} new
                        </p>
                        {run.errorMessage && (
                          <p className="text-xs text-[var(--critical)]">{run.errorMessage}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <Badge variant={run.status === "completed" ? "success" : run.status === "failed" ? "critical" : "warning"}>
                          {run.status}
                        </Badge>
                        <p className="mt-1 text-xs text-[var(--text-faint)]">
                          {new Date(run.createdAt).toLocaleString("en-US")}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {dismissedCount > 0 && (
            <div className="text-xs text-[var(--text-faint)]">
              {dismissedCount} dismissed candidate{dismissedCount !== 1 ? "s" : ""} hidden from future scans.
            </div>
          )}

          {tools.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Search className="h-12 w-12 text-[var(--text-faint)] mb-4" />
                <p className="text-[var(--text-muted)]">No AI tools discovered yet.</p>
                <p className="text-sm text-[var(--text-faint)] mt-1">
                  Click &quot;Scan Google Workspace&quot; to auto-detect or report tools manually.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
