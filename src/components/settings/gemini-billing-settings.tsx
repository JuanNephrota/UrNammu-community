"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  initial: {
    projectId: string;
    dataset: string;
    table: string;
    location: string;
    hasServiceAccountKey: boolean;
  };
}

export function GeminiBillingSettings({ initial }: Props) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(initial.projectId);
  const [dataset, setDataset] = useState(initial.dataset);
  const [table, setTable] = useState(initial.table);
  const [location, setLocation] = useState(initial.location || "US");
  const [serviceAccountKey, setServiceAccountKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);
    try {
      const payload: Record<string, string> = {
        gemini_billing_project_id: projectId.trim(),
        gemini_billing_dataset: dataset.trim(),
        gemini_billing_table: table.trim(),
        gemini_billing_location: location.trim() || "US",
      };
      if (serviceAccountKey.trim()) {
        payload.gemini_billing_service_account_key = serviceAccountKey.trim();
      }
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSaveResult("Gemini billing settings saved.");
        setServiceAccountKey("");
        router.refresh();
      } else {
        const text = await res.text();
        let msg = `HTTP ${res.status}`;
        try { msg = JSON.parse(text).error ?? msg; } catch { msg = text || msg; }
        setSaveResult(`Failed: ${msg}`);
      }
    } catch (err) {
      setSaveResult(`Failed: ${err instanceof Error ? err.message : "Network error"}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test-gemini-billing", { method: "POST" });
      const data = await res.json();
      setTestResult(res.ok ? data : { success: false, message: data.error ?? `HTTP ${res.status}` });
    } catch {
      setTestResult({ success: false, message: "Test failed." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-[var(--bg-base)] p-3">
        <ol className="space-y-1 text-xs text-[var(--text-muted)]">
          <li className="flex gap-2"><span className="font-bold shrink-0 text-[var(--accent)]">1.</span> Enable Cloud Billing export to BigQuery for the billing account that covers Gemini / Vertex AI usage.</li>
          <li className="flex gap-2"><span className="font-bold shrink-0 text-[var(--accent)]">2.</span> Create a Google Cloud service account with BigQuery read access to that dataset.</li>
          <li className="flex gap-2"><span className="font-bold shrink-0 text-[var(--accent)]">3.</span> Paste the service account JSON plus the BigQuery project, dataset, and billing export table below.</li>
        </ol>
        <a
          href="https://cloud.google.com/billing/docs/how-to/export-data-bigquery-tables"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[10px] text-[var(--accent)] hover:underline"
        >
          Google Cloud Billing Export Docs
        </a>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-xs">Billing Project ID</Label>
          <Input value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="my-gcp-project" />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">BigQuery Dataset</Label>
          <Input value={dataset} onChange={(e) => setDataset(e.target.value)} placeholder="billing_export" />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Billing Export Table</Label>
          <Input value={table} onChange={(e) => setTable(e.target.value)} placeholder="gcp_billing_export_v1_..." />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">BigQuery Location</Label>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="US" />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-xs">
          <KeyRound className="h-3 w-3" />
          Service Account JSON
        </Label>
        {initial.hasServiceAccountKey && !serviceAccountKey ? (
          <div className="flex items-center gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2">
            <Check className="h-3.5 w-3.5 text-[var(--success)]" />
            <span className="text-xs text-[var(--text-muted)] flex-1">Service account key configured</span>
            <Button size="sm" variant="ghost" onClick={() => setServiceAccountKey(" ")} className="text-xs h-6 px-2">
              Replace
            </Button>
          </div>
        ) : (
          <Input
            type="password"
            value={serviceAccountKey.trim()}
            onChange={(e) => setServiceAccountKey(e.target.value)}
            placeholder='{"type":"service_account", ...}'
            className="font-mono text-xs"
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button size="sm" variant="outline" onClick={handleTest} disabled={testing || !initial.hasServiceAccountKey}>
          {testing ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
          {testing ? "Testing..." : "Test Connection"}
        </Button>
        {saveResult && (
          <span className={`text-xs ${saveResult.includes("saved") ? "text-[var(--success)]" : "text-[var(--critical)]"}`}>
            {saveResult}
          </span>
        )}
        {testResult && (
          <span className={`text-xs ${testResult.success ? "text-[var(--success)]" : "text-[var(--critical)]"}`}>
            {testResult.message}
          </span>
        )}
      </div>
    </div>
  );
}
