"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, KeyRound, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  initial: {
    emailFrom: string;
    hasApiKey: boolean;
  };
}

export function ReportingEmailSettings({ initial }: Props) {
  const router = useRouter();
  const [emailFrom, setEmailFrom] = useState(initial.emailFrom);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);
    try {
      const payload: Record<string, string | null> = {
        report_email_from: emailFrom.trim() || null,
      };
      if (apiKey.trim()) payload.resend_api_key = apiKey.trim();

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSaveResult("Email delivery settings saved.");
        setApiKey("");
        router.refresh();
      } else {
        const text = await res.text();
        let msg = `HTTP ${res.status}`;
        try {
          msg = JSON.parse(text).error ?? msg;
        } catch {
          msg = text || msg;
        }
        setSaveResult(`Failed: ${msg}`);
      }
    } catch (err) {
      setSaveResult(`Failed: ${err instanceof Error ? err.message : "Network error"}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-[var(--bg-base)] p-3">
        <p className="text-xs text-[var(--text-muted)]">
          Scheduled reports are always saved to the in-app run history. To also email them to
          recipients, configure{" "}
          <a
            href="https://resend.com/docs/api-reference/emails/send-email"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent)] hover:underline"
          >
            Resend
          </a>
          . When unset, scheduled runs still succeed — email is simply skipped.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-xs">
          <Mail className="h-3 w-3" /> From address
        </Label>
        <Input
          value={emailFrom}
          onChange={(e) => setEmailFrom(e.target.value)}
          placeholder="UrNammu Reports <reports@yourdomain.com>"
        />
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-xs">
          <KeyRound className="h-3 w-3" /> Resend API Key
        </Label>
        {initial.hasApiKey && !apiKey ? (
          <div className="flex items-center gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2">
            <Check className="h-3.5 w-3.5 text-[var(--success)]" />
            <span className="flex-1 text-xs text-[var(--text-muted)]">API key configured</span>
            <Button size="sm" variant="ghost" onClick={() => setApiKey(" ")} className="h-6 px-2 text-xs">
              Replace
            </Button>
          </div>
        ) : (
          <Input
            type="password"
            value={apiKey.trim()}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="re_..."
            className="font-mono text-xs"
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
          {saving ? "Saving..." : "Save"}
        </Button>
        {saveResult && (
          <span
            className={`text-xs ${saveResult.includes("saved") ? "text-[var(--success)]" : "text-[var(--critical)]"}`}
          >
            {saveResult}
          </span>
        )}
      </div>
    </div>
  );
}
