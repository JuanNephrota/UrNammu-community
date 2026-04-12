"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Shield,
  Check,
  CircleAlert,
  X,
  Loader2,
  ExternalLink,
  Wifi,
  WifiOff,
  KeyRound,
  Mail,
  Calendar,
  Clock,
  ShieldCheck,
  Building2,
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
  scanIntervalHours: number;
  microsoftTenantId: string;
  microsoftClientId: string;
  hasMicrosoftClientSecret: boolean;
  microsoftScanEnabled: boolean;
  microsoftScanIntervalHours: number;
}

export function GoogleWorkspaceSettings({
  hasServiceKey,
  adminEmail: initialAdminEmail,
  scanEnabled: initialScanEnabled,
  lookbackDays: initialLookbackDays,
  scanIntervalHours: initialScanIntervalHours,
  microsoftTenantId: initialMicrosoftTenantId,
  microsoftClientId: initialMicrosoftClientId,
  hasMicrosoftClientSecret,
  microsoftScanEnabled: initialMicrosoftScanEnabled,
  microsoftScanIntervalHours: initialMicrosoftScanIntervalHours,
}: Props) {
  const router = useRouter();
  const [serviceKey, setServiceKey] = useState("");
  const [adminEmail, setAdminEmail] = useState(initialAdminEmail);
  const [scanEnabled, setScanEnabled] = useState(initialScanEnabled);
  const [lookbackDays, setLookbackDays] = useState(initialLookbackDays);
  const [scanIntervalHours, setScanIntervalHours] = useState(initialScanIntervalHours);
  const [microsoftTenantId, setMicrosoftTenantId] = useState(initialMicrosoftTenantId);
  const [microsoftClientId, setMicrosoftClientId] = useState(initialMicrosoftClientId);
  const [microsoftClientSecret, setMicrosoftClientSecret] = useState("");
  const [microsoftScanEnabled, setMicrosoftScanEnabled] = useState(initialMicrosoftScanEnabled);
  const [microsoftScanIntervalHours, setMicrosoftScanIntervalHours] = useState(initialMicrosoftScanIntervalHours);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingMicrosoft, setTestingMicrosoft] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [microsoftTestResult, setMicrosoftTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const trimmedServiceKey = serviceKey.trim();
  const normalizedAdminEmail = adminEmail.trim();
  const serviceKeyValidationError = (() => {
    if (!trimmedServiceKey) return null;
    try {
      if (!trimmedServiceKey.startsWith("{")) {
        return "Paste the raw service account JSON key exported from Google Cloud.";
      }
      const parsed = JSON.parse(trimmedServiceKey);
      if (parsed.type && parsed.type !== "service_account") {
        return "The uploaded key must be a Google service account JSON credential.";
      }
      if (!parsed.client_email || !parsed.private_key) {
        return "The service account key must include client_email and private_key.";
      }
      return null;
    } catch {
      return "The service account key must be valid JSON.";
    }
  })();
  const adminEmailLooksValid =
    !normalizedAdminEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedAdminEmail);
  const workspaceChecks = [
    { label: "Service account key", ok: hasServiceKey || (!!trimmedServiceKey && !serviceKeyValidationError) },
    { label: "Admin email", ok: !!normalizedAdminEmail && adminEmailLooksValid },
    { label: "Auto-scan", ok: scanEnabled },
  ];
  const microsoftTenantLooksValid =
    /^[0-9a-fA-F-]{36}$/.test(microsoftTenantId.trim()) ||
    /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(microsoftTenantId.trim());
  const microsoftClientLooksValid = /^[0-9a-fA-F-]{36}$/.test(
    microsoftClientId.trim()
  );
  const microsoftChecks = [
    { label: "Tenant ID", ok: microsoftTenantLooksValid },
    { label: "Client ID", ok: microsoftClientLooksValid },
    {
      label: "Client secret",
      ok: hasMicrosoftClientSecret || !!microsoftClientSecret.trim(),
    },
    { label: "Auto-scan", ok: microsoftScanEnabled },
  ];

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);
    try {
      const updates: Record<string, string | null> = {
        google_admin_email: adminEmail || null,
        google_scan_enabled: scanEnabled ? "true" : "false",
        google_scan_lookback_days: String(lookbackDays),
        google_scan_interval_hours: String(scanIntervalHours),
        microsoft_shadow_ai_tenant_id: microsoftTenantId.trim() || null,
        microsoft_shadow_ai_client_id: microsoftClientId.trim() || null,
        microsoft_shadow_ai_scan_enabled: microsoftScanEnabled ? "true" : "false",
        microsoft_shadow_ai_scan_interval_hours: String(microsoftScanIntervalHours),
      };
      // Only update the key if a new one was provided
      if (serviceKey.trim()) {
        updates.google_service_account_key = serviceKey.trim();
      }
      if (microsoftClientSecret.trim()) {
        updates.microsoft_shadow_ai_client_secret = microsoftClientSecret.trim();
      }

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (res.ok) {
        setSaveResult("Settings saved successfully.");
        setServiceKey(""); // Clear the key field after save
        setMicrosoftClientSecret("");
        router.refresh();
      } else {
        const text = await res.text();
        let msg = `HTTP ${res.status}`;
        try { msg = JSON.parse(text).error ?? msg; } catch { msg = text || msg; }
        setSaveResult(`Failed: ${msg}`);
      }
    } catch (err) {
      setSaveResult(`Failed to save settings: ${err instanceof Error ? err.message : "Network error"}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test-google", { method: "POST" });
      if (!res.ok) {
        const text = await res.text();
        let msg = `HTTP ${res.status}`;
        try { msg = JSON.parse(text).error ?? msg; } catch { msg = text || msg; }
        setTestResult({ success: false, message: msg });
      } else {
        const data = await res.json();
        setTestResult({
          success: data.success,
          message: data.success ? data.message : data.error,
        });
      }
    } catch (err) {
      setTestResult({ success: false, message: `Connection test failed: ${err instanceof Error ? err.message : "Network error"}` });
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

  async function handleTestMicrosoft() {
    setTestingMicrosoft(true);
    setMicrosoftTestResult(null);
    try {
      const res = await fetch("/api/settings/test-microsoft-shadow-ai", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setMicrosoftTestResult({
          success: false,
          message: data.error ?? `HTTP ${res.status}`,
        });
      } else {
        setMicrosoftTestResult({
          success: data.success,
          message: data.success ? data.message : data.error,
        });
      }
    } catch (err) {
      setMicrosoftTestResult({
        success: false,
        message: `Connection test failed: ${err instanceof Error ? err.message : "Network error"}`,
      });
    } finally {
      setTestingMicrosoft(false);
    }
  }

  async function handleClearMicrosoftSecret() {
    if (!confirm("Remove the stored Microsoft 365 client secret?")) return;
    setSaving(true);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ microsoft_shadow_ai_client_secret: null }),
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
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Shadow AI discovery lives here</p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
              This integration scans Google Workspace audit activity to discover shadow AI usage.
              Employee login methods such as Google sign-in are configured separately under{" "}
              <Link href="/settings/users" className="text-[var(--accent)] hover:underline">
                Users &amp; Identity
              </Link>
              .
            </p>
          </div>

          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
              Shadow AI Health Checklist
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {workspaceChecks.map((check) => (
                <div
                  key={check.label}
                  className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-muted)]"
                >
                  {check.ok ? (
                    <ShieldCheck className="h-3.5 w-3.5 text-[var(--success)]" />
                  ) : (
                    <CircleAlert className="h-3.5 w-3.5 text-[var(--warning)]" />
                  )}
                  <span>{check.label}</span>
                </div>
              ))}
            </div>
          </div>

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
              {serviceKeyValidationError && (
                <p className="mt-2 text-xs text-[var(--critical)]">{serviceKeyValidationError}</p>
              )}
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
            {!adminEmailLooksValid && (
              <p className="text-xs text-[var(--critical)]">Enter a valid Workspace admin email address.</p>
            )}
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
                <option value="true">Enabled</option>
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

          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" />
              Scan Interval
            </Label>
            <select
              value={String(scanIntervalHours)}
              onChange={(e) => setScanIntervalHours(parseInt(e.target.value, 10))}
              className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
            >
              <option value="6">Every 6 hours</option>
              <option value="12">Every 12 hours</option>
              <option value="24">Every 24 hours</option>
              <option value="48">Every 48 hours</option>
            </select>
            <p className="text-[10px] text-[var(--text-faint)]">
              The background scheduler checks this cadence when `CRON_SECRET`-authenticated maintenance requests run.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-[var(--border-subtle)]">
            <Button onClick={handleSave} disabled={saving || !!serviceKeyValidationError || !adminEmailLooksValid}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {saving ? "Saving..." : "Save Configuration"}
            </Button>
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testing || !!serviceKeyValidationError || !adminEmailLooksValid || (!hasServiceKey && !trimmedServiceKey)}
            >
              {testing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Wifi className="mr-2 h-4 w-4" />
              )}
              {testing ? "Testing..." : "Test Connection"}
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/shadow-ai">
                Open Shadow AI Dashboard <ArrowRight className="h-4 w-4" />
              </Link>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[var(--accent)]" />
            Microsoft 365 Configuration
          </CardTitle>
          <CardDescription>
            Connect to Microsoft Graph to discover AI tools that users have connected through delegated app permissions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div
            className="flex items-center gap-3 rounded-xl border px-5 py-4"
            style={{
              borderColor:
                microsoftTenantLooksValid &&
                microsoftClientLooksValid &&
                (hasMicrosoftClientSecret || !!microsoftClientSecret.trim())
                  ? "rgba(16, 185, 129, 0.2)"
                  : "rgba(245, 158, 11, 0.2)",
              background:
                microsoftTenantLooksValid &&
                microsoftClientLooksValid &&
                (hasMicrosoftClientSecret || !!microsoftClientSecret.trim())
                  ? "rgba(16, 185, 129, 0.05)"
                  : "rgba(245, 158, 11, 0.05)",
            }}
          >
            {microsoftTenantLooksValid &&
            microsoftClientLooksValid &&
            (hasMicrosoftClientSecret || !!microsoftClientSecret.trim()) ? (
              <>
                <Wifi className="h-5 w-5 text-[var(--success)]" />
                <div>
                <p className="text-sm font-medium text-[var(--success)]">
                  Microsoft 365 Connected
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                    Shadow AI scanning is available for tenant {microsoftTenantId.trim()}.
                </p>
                </div>
              </>
            ) : (
              <>
                <WifiOff className="h-5 w-5 text-[var(--warning)]" />
                <div>
                  <p className="text-sm font-medium text-[var(--warning)]">
                    Microsoft 365 Not Configured
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    Add a tenant app to scan delegated app permissions in Microsoft Graph.
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
              Microsoft 365 Health Checklist
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              {microsoftChecks.map((check) => (
                <div
                  key={check.label}
                  className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-muted)]"
                >
                  {check.ok ? (
                    <ShieldCheck className="h-3.5 w-3.5 text-[var(--success)]" />
                  ) : (
                    <CircleAlert className="h-3.5 w-3.5 text-[var(--warning)]" />
                  )}
                  <span>{check.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-3">
              Setup Requirements
            </p>
            <ol className="space-y-2 text-sm text-[var(--text-muted)]">
              <li className="flex gap-2">
                <span className="text-[var(--accent)] font-bold shrink-0">1.</span>
                Register an Entra ID app for Shadow AI scanning.
              </li>
              <li className="flex gap-2">
                <span className="text-[var(--accent)] font-bold shrink-0">2.</span>
                Add Microsoft Graph application permissions for reading delegated app consent data.
              </li>
              <li className="flex gap-2">
                <span className="text-[var(--accent)] font-bold shrink-0">3.</span>
                Grant tenant-wide admin consent and create a client secret.
              </li>
              <li className="flex gap-2">
                <span className="text-[var(--accent)] font-bold shrink-0">4.</span>
                Paste the tenant ID, client ID, and client secret below.
              </li>
            </ol>
            <p className="mt-3 text-xs text-[var(--text-faint)]">
              This MVP inspects delegated app grants in Microsoft Graph rather than browser traffic or endpoint logs.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Tenant ID</Label>
              <Input
                value={microsoftTenantId}
                onChange={(e) => setMicrosoftTenantId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
              {!!microsoftTenantId && !microsoftTenantLooksValid && (
                <p className="text-xs text-[var(--critical)]">Enter a valid Azure tenant ID or tenant domain.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Client ID</Label>
              <Input
                value={microsoftClientId}
                onChange={(e) => setMicrosoftClientId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
              {!!microsoftClientId && !microsoftClientLooksValid && (
                <p className="text-xs text-[var(--critical)]">Enter a valid application client ID (GUID).</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Client Secret</Label>
            {hasMicrosoftClientSecret ? (
              <div className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-3">
                <Check className="h-4 w-4 text-[var(--success)]" />
                <span className="text-sm text-[var(--text-muted)] flex-1">
                  Microsoft 365 client secret is configured
                </span>
                <Button size="sm" variant="ghost" onClick={handleClearMicrosoftSecret} disabled={saving}>
                  <X className="h-3 w-3 mr-1" /> Remove
                </Button>
              </div>
            ) : null}
            <Input
              type="password"
              value={microsoftClientSecret}
              onChange={(e) => setMicrosoftClientSecret(e.target.value)}
              placeholder={hasMicrosoftClientSecret ? "Paste a new secret to replace the stored one" : "Paste your client secret"}
            />
            <p className="text-[10px] text-[var(--text-faint)]">
              The secret is stored encrypted in the database and used only for Microsoft Graph scanning.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Auto-scan</Label>
              <select
                value={microsoftScanEnabled ? "true" : "false"}
                onChange={(e) => setMicrosoftScanEnabled(e.target.value === "true")}
                className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
              >
                <option value="false">Disabled</option>
                <option value="true">Enabled</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Scan Interval</Label>
              <select
                value={String(microsoftScanIntervalHours)}
                onChange={(e) => setMicrosoftScanIntervalHours(parseInt(e.target.value, 10))}
                className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
              >
                <option value="6">Every 6 hours</option>
                <option value="12">Every 12 hours</option>
                <option value="24">Every 24 hours</option>
                <option value="48">Every 48 hours</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-[var(--border-subtle)]">
            <Button
              onClick={handleSave}
              disabled={
                saving ||
                !microsoftTenantLooksValid ||
                !microsoftClientLooksValid ||
                (!hasMicrosoftClientSecret && !microsoftClientSecret.trim())
              }
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {saving ? "Saving..." : "Save Microsoft 365 Configuration"}
            </Button>
            <Button
              variant="outline"
              onClick={handleTestMicrosoft}
              disabled={
                testingMicrosoft ||
                !microsoftTenantLooksValid ||
                !microsoftClientLooksValid ||
                (!hasMicrosoftClientSecret && !microsoftClientSecret.trim())
              }
            >
              {testingMicrosoft ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Wifi className="mr-2 h-4 w-4" />
              )}
              {testingMicrosoft ? "Testing..." : "Test Microsoft 365"}
            </Button>
          </div>

          {microsoftTestResult && (
            <div
              className="flex items-start gap-3 rounded-lg border p-4"
              style={{
                borderColor: microsoftTestResult.success
                  ? "rgba(16, 185, 129, 0.2)"
                  : "rgba(239, 68, 68, 0.2)",
                background: microsoftTestResult.success
                  ? "rgba(16, 185, 129, 0.05)"
                  : "rgba(239, 68, 68, 0.05)",
              }}
            >
              {microsoftTestResult.success ? (
                <Check className="h-4 w-4 text-[var(--success)] mt-0.5 shrink-0" />
              ) : (
                <X className="h-4 w-4 text-[var(--critical)] mt-0.5 shrink-0" />
              )}
              <p
                className="text-sm"
                style={{
                  color: microsoftTestResult.success
                    ? "var(--success)"
                    : "var(--critical)",
                }}
              >
                {microsoftTestResult.message}
              </p>
            </div>
          )}

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
