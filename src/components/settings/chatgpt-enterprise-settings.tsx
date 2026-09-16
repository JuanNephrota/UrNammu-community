"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, KeyRound, Loader2, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  initial: {
    workspaceId: string;
    hasAdminKey: boolean;
  };
}

export function ChatGPTEnterpriseSettings({ initial }: Props) {
  const router = useRouter();
  const [workspaceId, setWorkspaceId] = useState(initial.workspaceId);
  const [adminKey, setAdminKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const hasConfig = initial.hasAdminKey && workspaceId.trim().length > 0;

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);
    try {
      const payload: Record<string, string | null> = {
        chatgpt_workspace_id: workspaceId.trim() || null,
      };
      if (adminKey.trim()) {
        payload.chatgpt_enterprise_admin_key = adminKey.trim();
      }

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSaveResult("ChatGPT Enterprise settings saved.");
        setAdminKey("");
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
      const res = await fetch("/api/settings/test-chatgpt-enterprise", { method: "POST" });
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
          <li className="flex gap-2"><span className="font-bold shrink-0 text-[var(--accent)]">1.</span> As a ChatGPT Enterprise / Edu <strong>workspace owner</strong>, open the OpenAI Admin Console → Credentials → Admin keys and create a workspace-scoped key.</li>
          <li className="flex gap-2"><span className="font-bold shrink-0 text-[var(--accent)]">2.</span> Grant read access to <code>Users</code>, <code>GPTs</code>, and <strong>Compliance logging platform</strong> (auth, audit, Codex logs; conversation messages only if you want per-user message counts — UrNammu stores counts, never content).</li>
          <li className="flex gap-2"><span className="font-bold shrink-0 text-[var(--accent)]">3.</span> Paste the key and the workspace id below, save, then <strong>Test</strong>. The hourly <code>chatgpt_enterprise</code> sync then runs on the Provider Admin APIs schedule.</li>
        </ol>
        <a
          href="https://chatgpt.com/public/admin/api-reference"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[10px] text-[var(--accent)] hover:underline"
        >
          OpenAI Admin API Reference
        </a>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Workspace ID</Label>
        <Input
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
          placeholder="f7f33107-5fb9-4ee1-8922-3eae76b5b5a0"
          className="font-mono text-xs"
        />
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-xs">
          <KeyRound className="h-3 w-3" />
          Admin Key
        </Label>
        {initial.hasAdminKey && !adminKey ? (
          <div className="flex items-center gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2">
            <Check className="h-3.5 w-3.5 text-[var(--success)]" />
            <span className="text-xs text-[var(--text-muted)] flex-1">Admin key configured</span>
            <Button size="sm" variant="ghost" onClick={() => setAdminKey(" ")} className="text-xs h-6 px-2">
              Replace
            </Button>
          </div>
        ) : (
          <Input
            type="password"
            value={adminKey.trim()}
            onChange={(e) => setAdminKey(e.target.value)}
            placeholder="sk-admin-..."
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
