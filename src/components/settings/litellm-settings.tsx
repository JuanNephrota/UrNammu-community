"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, KeyRound, Loader2, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  initial: {
    baseUrl: string;
    hasApiKey: boolean;
  };
}

export function LiteLLMSettings({ initial }: Props) {
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const hasConfig = initial.hasApiKey && baseUrl.trim().length > 0;

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);
    try {
      const payload: Record<string, string | null> = {
        litellm_api_base_url: baseUrl.trim() || null,
      };
      if (apiKey.trim()) {
        payload.litellm_api_key = apiKey.trim();
      }

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSaveResult("LiteLLM settings saved.");
        setApiKey("");
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
      const res = await fetch("/api/settings/test-litellm", { method: "POST" });
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
          <li className="flex gap-2"><span className="font-bold shrink-0 text-[var(--accent)]">1.</span> Deploy the LiteLLM proxy (self-hosted) and note its base URL.</li>
          <li className="flex gap-2"><span className="font-bold shrink-0 text-[var(--accent)]">2.</span> Generate a master key (<code>sk-...</code>) on that proxy or grab one from your secret store.</li>
          <li className="flex gap-2"><span className="font-bold shrink-0 text-[var(--accent)]">3.</span> Paste the master key below and set the base URL to your proxy (for example <code>https://litellm.internal</code>).</li>
        </ol>
        <a
          href="https://docs.litellm.ai/docs/proxy/ui_logs_spend"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[10px] text-[var(--accent)] hover:underline"
        >
          LiteLLM Proxy Spend Logs Docs
        </a>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Proxy Base URL</Label>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://litellm.internal"
        />
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-xs">
          <KeyRound className="h-3 w-3" />
          Master Key
        </Label>
        {initial.hasApiKey && !apiKey ? (
          <div className="flex items-center gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2">
            <Check className="h-3.5 w-3.5 text-[var(--success)]" />
            <span className="text-xs text-[var(--text-muted)] flex-1">Master key configured</span>
            <Button size="sm" variant="ghost" onClick={() => setApiKey(" ")} className="text-xs h-6 px-2">
              Replace
            </Button>
          </div>
        ) : (
          <Input
            type="password"
            value={apiKey.trim()}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-litellm-..."
            className="font-mono text-xs"
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button size="sm" variant="outline" onClick={handleTest} disabled={testing || !hasConfig}>
          {testing ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Wifi className="mr-1.5 h-3 w-3" />}
          {testing ? "Testing..." : "Test"}
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
