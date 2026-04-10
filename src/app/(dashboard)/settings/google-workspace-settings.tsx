"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Shield,
  Check,
  X,
  Loader2,
  ExternalLink,
  Wifi,
  WifiOff,
  KeyRound,
  Mail,
  Calendar,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface Props {
  hasServiceKey: boolean;
  adminEmail: string;
  scanEnabled: boolean;
  lookbackDays: number;
}

export function GoogleWorkspaceSettings({
  hasServiceKey,
  adminEmail: initialAdminEmail,
  scanEnabled: initialScanEnabled,
  lookbackDays: initialLookbackDays,
}: Props) {
  const router = useRouter();
  const [serviceKey, setServiceKey] = useState("");
  const [adminEmail, setAdminEmail] = useState(initialAdminEmail);
  const [scanEnabled, setScanEnabled] = useState(initialScanEnabled);
  const [lookbackDays, setLookbackDays] = useState(initialLookbackDays);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [saveResult, setSaveResult] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);
    try {
      const updates: Record<string, string | null> = {
        google_admin_email: adminEmail || null,
        google_scan_enabled: scanEnabled ? "true" : "false",
        google_scan_lookback_days: String(lookbackDays),
      };
      // Only update the key if a new one was provided
      if (serviceKey.trim()) {
        updates.google_service_account_key = serviceKey.trim();
      }

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (res.ok) {
        setSaveResult("Settings saved successfully.");
        setServiceKey(""); // Clear the key field after save
        router.refresh();
      } else {
        const data = await res.json();
        setSaveResult(`Failed: ${data.error}`);
      }
    } catch {
      setSaveResult("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test-google", { method: "POST" });
      const data = await res.json();
      setTestResult({
        success: data.success,
        message: data.success ? data.message : data.error,
      });
    } catch {
      setTestResult({ success: false, message: "Connection test failed." });
    } finally {
      setTesting(false);
    }
  }

  async function handleClearKey() {
    if (!confirm("Remove the stored service account key?")) return;
    setSaving(true);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ google_service_account_key: null }),
    });
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      <div
        className="flex items-center gap-3 rounded-xl border px-5 py-4"
        style={{
          borderColor: hasServiceKey && adminEmail
            ? "rgba(16, 185, 129, 0.2)"
            : "rgba(245, 158, 11, 0.2)",
          background: hasServiceKey && adminEmail
            ? "rgba(16, 185, 129, 0.05)"
            : "rgba(245, 158, 11, 0.05)",
        }}
      >
        {hasServiceKey && adminEmail ? (
          <>
            <Wifi className="h-5 w-5 text-[var(--success)]" />
            <div>
              <p className="text-sm font-medium text-[var(--success)]">
                Google Workspace Connected
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                Shadow AI scanning is available. Admin: {adminEmail}
              </p>
            </div>
          </>
        ) : (
          <>
            <WifiOff className="h-5 w-5 text-[var(--warning)]" />
            <div>
              <p className="text-sm font-medium text-[var(--warning)]">
                Google Workspace Not Configured
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                Configure your service account to enable automatic shadow AI detection.
              </p>
            </div>
          </>
        )}
      </div>

      {/* Setup Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-[var(--accent)]" />
            Google Workspace Configuration
          </CardTitle>
          <CardDescription>
            Connect to Google Workspace Admin SDK to automatically discover AI tools authorized by employees via OAuth.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Setup steps */}
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-3">
              Setup Requirements
            </p>
            <ol className="space-y-2 text-sm text-[var(--text-muted)]">
              <li className="flex gap-2">
                <span className="text-[var(--accent)] font-bold shrink-0">1.</span>
                Create a GCP project and enable the Admin SDK API
              </li>
              <li className="flex gap-2">
                <span className="text-[var(--accent)] font-bold shrink-0">2.</span>
                Create a service account with domain-wide delegation
              </li>
              <li className="flex gap-2">
                <span className="text-[var(--accent)] font-bold shrink-0">3.</span>
                <span>
                  In Admin Console &gt; Security &gt; API controls &gt; Domain-wide delegation, add the service account client ID with these OAuth scopes:
                </span>
              </li>
              <li className="ml-6 -mt-1">
                <div className="flex flex-col gap-1.5">
                  <code className="block text-[10px] bg-[var(--bg-elevated)] px-2 py-1 rounded font-mono select-all text-[var(--accent)]">
                    https://www.googleapis.com/auth/admin.reports.audit.readonly
                  </code>
                  <code className="block text-[10px] bg-[var(--bg-elevated)] px-2 py-1 rounded font-mono select-all text-[var(--accent)]">
                    https://www.googleapis.com/auth/admin.directory.user.security
                  </code>
                </div>
              </li>
              <li className="flex gap-2">
                <span className="text-[var(--accent)] font-bold shrink-0">4.</span>
                Download the service account JSON key and paste it below
              </li>
            </ol>
            <a
              href="https://developers.google.com/admin-sdk/reports/v1/quickstart/nodejs"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
            >
              Google Admin SDK Quickstart <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {/* Service Account Key */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5" />
              Service Account Key (JSON)
            </Label>
            {hasServiceKey ? (
              <div className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-3">
                <Check className="h-4 w-4 text-[var(--success)]" />
                <span className="text-sm text-[var(--text-muted)] flex-1">
                  Service account key is configured
                </span>
                <Button size="sm" variant="ghost" onClick={handleClearKey} disabled={saving}>
                  <X className="h-3 w-3 mr-1" /> Remove
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const el = document.getElementById("service-key-replace");
                    if (el) el.classList.toggle("hidden");
                  }}
                >
                  Replace
                </Button>
              </div>
            ) : null}
            <div id="service-key-replace" className={hasServiceKey ? "hidden" : ""}>
              <Textarea
                value={serviceKey}
                onChange={(e) => setServiceKey(e.target.value)}
                rows={6}
                placeholder='Paste your service account JSON key here (starts with {"type": "service_account", ...})'
                className="font-mono text-xs"
              />
              <p className="text-[10px] text-[var(--text-faint)] mt-1">
                The key is stored encrypted in the database. It is never exposed in the UI after saving.
              </p>
            </div>
          </div>

          {/* Admin Email */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Mail className="h-3.5 w-3.5" />
              Workspace Admin Email
            </Label>
            <Input
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="admin@yourdomain.com"
              type="email"
            />
            <p className="text-[10px] text-[var(--text-faint)]">
              A Google Workspace admin email for the service account to impersonate via domain-wide delegation.
            </p>
          </div>

          {/* Scan Settings */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5" />
                Auto-scan
              </Label>
              <select
                value={scanEnabled ? "true" : "false"}
                onChange={(e) => setScanEnabled(e.target.value === "true")}
                className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
              >
                <option value="false">Disabled</option>
                <option value="true">Enabled (daily at 2 AM)</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5" />
                Lookback Period
              </Label>
              <select
                value={String(lookbackDays)}
                onChange={(e) => setLookbackDays(parseInt(e.target.value))}
                className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
              >
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
                <option value="180">180 days</option>
              </select>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-[var(--border-subtle)]">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {saving ? "Saving..." : "Save Configuration"}
            </Button>
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testing || (!hasServiceKey && !serviceKey.trim())}
            >
              {testing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Wifi className="mr-2 h-4 w-4" />
              )}
              {testing ? "Testing..." : "Test Connection"}
            </Button>
          </div>

          {/* Test Result */}
          {testResult && (
            <div
              className="flex items-start gap-3 rounded-lg border p-4"
              style={{
                borderColor: testResult.success
                  ? "rgba(16, 185, 129, 0.2)"
                  : "rgba(239, 68, 68, 0.2)",
                background: testResult.success
                  ? "rgba(16, 185, 129, 0.05)"
                  : "rgba(239, 68, 68, 0.05)",
              }}
            >
              {testResult.success ? (
                <Check className="h-4 w-4 text-[var(--success)] mt-0.5 shrink-0" />
              ) : (
                <X className="h-4 w-4 text-[var(--critical)] mt-0.5 shrink-0" />
              )}
              <p
                className="text-sm"
                style={{
                  color: testResult.success
                    ? "var(--success)"
                    : "var(--critical)",
                }}
              >
                {testResult.message}
              </p>
            </div>
          )}

          {/* Save Result */}
          {saveResult && (
            <p
              className={`text-sm font-medium ${
                saveResult.includes("success")
                  ? "text-[var(--success)]"
                  : "text-[var(--critical)]"
              }`}
            >
              {saveResult}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
