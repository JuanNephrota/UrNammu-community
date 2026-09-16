"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, KeyRound, Loader2, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  initial: {
    org: string;
    enterprise: string;
    hasToken: boolean;
  };
}

/**
 * Settings body for the GitHub Copilot usage metrics sync: a token plus the
 * organization login and/or enterprise slug it reads. Enterprise wins when
 * both are set. Saved through PUT /api/settings; the token is encrypted at
 * rest (settings-crypto SECRET_KEYS).
 */
export function GitHubCopilotSettings({ initial }: Props) {
  const router = useRouter();
  const [org, setOrg] = useState(initial.org);
  const [enterprise, setEnterprise] = useState(initial.enterprise);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const hasScope = org.trim().length > 0 || enterprise.trim().length > 0;
  const hasConfig = initial.hasToken && hasScope;

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);
    try {
      const payload: Record<string, string | null> = {
        github_copilot_org: org.trim() || null,
        github_copilot_enterprise: enterprise.trim() || null,
      };
      if (token.trim()) payload.github_copilot_token = token.trim();

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSaveResult("GitHub Copilot settings saved.");
        setToken("");
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
      const res = await fetch("/api/settings/test-github-copilot", { method: "POST" });
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
          <li className="flex gap-2"><span className="font-bold shrink-0 text-[var(--accent)]">1.</span> In the GitHub organization (or enterprise) settings, enable the <strong>Copilot usage metrics</strong> policy — every report endpoint returns 403 until it is on.</li>
          <li className="flex gap-2"><span className="font-bold shrink-0 text-[var(--accent)]">2.</span> Create a token as an org owner: classic PAT with <code>read:org</code> for an organization, or <code>manage_billing:copilot</code> / <code>read:enterprise</code> for an enterprise. Fine-grained tokens need &ldquo;View Organization Copilot Metrics&rdquo; plus Copilot billing read for seats.</li>
          <li className="flex gap-2"><span className="font-bold shrink-0 text-[var(--accent)]">3.</span> Enter the organization login and/or enterprise slug and paste the token. Reports cover 2025-10-10 onward and land within two days.</li>
        </ol>
        <a
          href="https://docs.github.com/en/rest/copilot/copilot-usage-metrics?apiVersion=2026-03-10"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[10px] text-[var(--accent)] hover:underline"
        >
          GitHub Copilot usage metrics API docs
        </a>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-xs">Organization login</Label>
          <Input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="my-org" />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Enterprise slug (optional, takes precedence)</Label>
          <Input value={enterprise} onChange={(e) => setEnterprise(e.target.value)} placeholder="my-enterprise" />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-xs">
          <KeyRound className="h-3 w-3" />
          GitHub token
        </Label>
        {initial.hasToken && !token ? (
          <div className="flex items-center gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2">
            <Check className="h-3.5 w-3.5 text-[var(--success)]" />
            <span className="text-xs text-[var(--text-muted)] flex-1">Token configured (encrypted)</span>
            <Button size="sm" variant="ghost" onClick={() => setToken(" ")} className="text-xs h-6 px-2">
              Replace
            </Button>
          </div>
        ) : (
          <Input
            type="password"
            value={token.trim()}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_... or github_pat_..."
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
