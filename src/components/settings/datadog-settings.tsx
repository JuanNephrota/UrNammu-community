"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, KeyRound, Loader2, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DATADOG_SITE_OPTIONS: { value: string; label: string }[] = [
  { value: "datadoghq.com", label: "US1 (datadoghq.com)" },
  { value: "us3.datadoghq.com", label: "US3 (us3.datadoghq.com)" },
  { value: "us5.datadoghq.com", label: "US5 (us5.datadoghq.com)" },
  { value: "datadoghq.eu", label: "EU (datadoghq.eu)" },
  { value: "ap1.datadoghq.com", label: "AP1 (ap1.datadoghq.com)" },
  { value: "ddog-gov.com", label: "Gov (ddog-gov.com)" },
];

interface Props {
  initial: {
    hasApiKey: boolean;
    hasAppKey: boolean;
    site: string;
    enabled: boolean;
  };
}

export function DatadogSettings({ initial }: Props) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [appKey, setAppKey] = useState("");
  const [site, setSite] = useState(initial.site || "datadoghq.com");
  const [enabled, setEnabled] = useState(initial.enabled);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);
    try {
      const payload: Record<string, string | null> = {
        datadog_site: site,
        datadog_enabled: enabled ? "true" : "false",
      };
      if (apiKey.trim()) payload.datadog_api_key = apiKey.trim();
      if (appKey.trim()) payload.datadog_app_key = appKey.trim();

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSaveResult("Datadog settings saved.");
        setApiKey("");
        setAppKey("");
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
      const res = await fetch("/api/settings/test-datadog", { method: "POST" });
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
        <p className="text-xs text-[var(--text-muted)]">
          Forward UrNammu governance events (alerts, sync failures, policy triggers) to your Datadog
          org as events. Enable the toggle below after saving credentials to start emitting.
        </p>
        <a
          href="https://docs.datadoghq.com/api/latest/events/"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[10px] text-[var(--accent)] hover:underline"
        >
          Datadog Events API Docs
        </a>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Datadog Site</Label>
        <select
          value={site}
          onChange={(e) => setSite(e.target.value)}
          className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
        >
          {DATADOG_SITE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-xs">
          <KeyRound className="h-3 w-3" />
          API Key
        </Label>
        {initial.hasApiKey && !apiKey ? (
          <div className="flex items-center gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2">
            <Check className="h-3.5 w-3.5 text-[var(--success)]" />
            <span className="text-xs text-[var(--text-muted)] flex-1">API key configured</span>
            <Button size="sm" variant="ghost" onClick={() => setApiKey(" ")} className="text-xs h-6 px-2">
              Replace
            </Button>
          </div>
        ) : (
          <Input
            type="password"
            value={apiKey.trim()}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="32-char Datadog API key"
            className="font-mono text-xs"
          />
        )}
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-xs">
          <KeyRound className="h-3 w-3" />
          Application Key <span className="text-[var(--text-faint)]">(optional — only needed for metrics / dashboards)</span>
        </Label>
        {initial.hasAppKey && !appKey ? (
          <div className="flex items-center gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2">
            <Check className="h-3.5 w-3.5 text-[var(--success)]" />
            <span className="text-xs text-[var(--text-muted)] flex-1">App key configured</span>
            <Button size="sm" variant="ghost" onClick={() => setAppKey(" ")} className="text-xs h-6 px-2">
              Replace
            </Button>
          </div>
        ) : (
          <Input
            type="password"
            value={appKey.trim()}
            onChange={(e) => setAppKey(e.target.value)}
            placeholder="40-char Datadog application key"
            className="font-mono text-xs"
          />
        )}
      </div>

      <label className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>
          Forward governance events to Datadog
          <br />
          <span className="text-[10px] text-[var(--text-faint)]">
            Off by default. Nothing is emitted until you enable this.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button size="sm" variant="outline" onClick={handleTest} disabled={testing || !initial.hasApiKey}>
          {testing ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Wifi className="mr-1.5 h-3 w-3" />}
          {testing ? "Sending..." : "Send Test Event"}
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
