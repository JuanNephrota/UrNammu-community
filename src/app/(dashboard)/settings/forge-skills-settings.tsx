"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

interface Props {
  initial: {
    baseUrl: string;
    hasApiKey: boolean;
    syncEnabled: boolean;
    lastSince: string | null;
  };
}

export function ForgeSkillsSettings({ initial }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [syncEnabled, setSyncEnabled] = useState(initial.syncEnabled);

  async function handleSave() {
    setSaving(true);
    setResult(null);

    const updates: Record<string, string | null> = {
      forge_base_url: baseUrl.trim() || null,
      forge_sync_enabled: syncEnabled ? "true" : "false",
    };
    if (apiKey.trim()) updates.forge_integration_key = apiKey.trim();

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const body = await res.json();
        setResult(`Failed: ${body.error ?? res.statusText}`);
      } else {
        setResult("Forge settings saved.");
        setApiKey("");
        router.refresh();
      }
    } catch {
      setResult("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--accent)]" />
          Forge Skills Integration
        </CardTitle>
        <CardDescription>
          Feeds the{" "}
          <Link className="underline" href="/registry/skills">
            AI Skills
          </Link>{" "}
          registry. The API key comes from Azure Key Vault:{" "}
          <code className="text-[11px]">
            az keyvault secret show --vault-name certifid-forge-kv --name
            forge-integration-key-peter-prod --query value -o tsv
          </code>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="forge-base">Base URL</Label>
          <Input
            id="forge-base"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://forge.certifid.com/api/integrations/security/v1"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="forge-key" className="flex items-center gap-2">
            <KeyRound className="h-3.5 w-3.5" />
            API Key {initial.hasApiKey ? <span className="text-[var(--success)]">· set</span> : null}
          </Label>
          <Input
            id="forge-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={initial.hasApiKey ? "(configured — paste to replace)" : "forge_sec_…"}
            className="font-mono text-xs"
          />
        </div>

        <label className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={syncEnabled}
            onChange={(e) => setSyncEnabled(e.target.checked)}
          />
          <span>
            Enable hourly auto-sync (Vercel cron, :00 each hour)
            <br />
            <span className="text-[10px] text-[var(--text-faint)]">
              Off by default. When off, the Sync now button still works.
            </span>
          </span>
        </label>

        {initial.lastSince ? (
          <p className="text-[11px] text-[var(--text-faint)]">
            Last <code>since</code> cursor: {new Date(initial.lastSince).toLocaleString()}
          </p>
        ) : null}

        <div className="flex items-center gap-3 pt-2 border-t border-[var(--border-subtle)]">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {saving ? "Saving…" : "Save Forge settings"}
          </Button>
          {result ? (
            <p
              className={`text-sm font-medium ${
                result.includes("saved")
                  ? "text-[var(--success)]"
                  : "text-[var(--critical)]"
              }`}
            >
              {result}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
