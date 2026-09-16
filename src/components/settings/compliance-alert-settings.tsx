"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Governance-rule knobs for the Anthropic Compliance feed: the organization's
 * timezone (drives the 07:00–19:00 "outside business hours" API-key alert)
 * and how far back the first feed pull reaches.
 */
export function ComplianceAlertSettings({ initial }: { initial: { orgTimezone: string; lookbackDays: string } }) {
  const router = useRouter();
  const [orgTimezone, setOrgTimezone] = useState(initial.orgTimezone);
  const [lookbackDays, setLookbackDays] = useState(initial.lookbackDays);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const timezoneValid = (() => {
    if (!orgTimezone.trim()) return true;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: orgTimezone.trim() });
      return true;
    } catch {
      return false;
    }
  })();

  async function handleSave() {
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_timezone: orgTimezone.trim() || null,
          anthropic_compliance_lookback_days: lookbackDays.trim() || null,
        }),
      });
      if (res.ok) {
        setResult("Saved.");
        router.refresh();
      } else {
        const text = await res.text();
        let msg = `HTTP ${res.status}`;
        try { msg = JSON.parse(text).error ?? msg; } catch { msg = text || msg; }
        setResult(`Failed: ${msg}`);
      }
    } catch {
      setResult("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] p-4 space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">Governance rules</h4>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          New activities are checked on every sync: an API key created by an actor UrNammu has never seen, an API key
          created outside 07:00–19:00 in the organization&apos;s timezone, a Compliance API read from a key never seen
          before, and a login from a new country when the feed reports one.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Organization timezone (IANA)</Label>
          <Input
            value={orgTimezone}
            onChange={(e) => setOrgTimezone(e.target.value)}
            placeholder="UTC"
            className="font-mono text-xs"
          />
          <p className="text-[10px] text-[var(--text-faint)]">
            e.g. <code>America/New_York</code>, <code>Europe/London</code>. Blank means UTC.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">First-pull lookback (days)</Label>
          <Input
            type="number"
            min={1}
            max={365}
            value={lookbackDays}
            onChange={(e) => setLookbackDays(e.target.value)}
            placeholder="30"
            className="font-mono text-xs"
          />
          <p className="text-[10px] text-[var(--text-faint)]">
            The feed has no history before it was enabled in the Anthropic Console.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving || !timezoneValid}>
          {saving ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Check className="mr-1.5 h-3 w-3" />}
          {saving ? "Saving..." : "Save"}
        </Button>
        {!timezoneValid && <span className="text-xs text-[var(--critical)]">Unknown timezone.</span>}
        {result && (
          <span className={`text-xs ${result.includes("Saved") ? "text-[var(--success)]" : "text-[var(--critical)]"}`}>{result}</span>
        )}
      </div>
    </div>
  );
}
