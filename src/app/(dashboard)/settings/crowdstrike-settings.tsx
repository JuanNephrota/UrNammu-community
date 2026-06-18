"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CircleAlert,
  Clock,
  Calendar,
  KeyRound,
  Loader2,
  Globe,
  ShieldCheck,
  ShieldAlert,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
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
import { CROWDSTRIKE_CLOUDS, CROWDSTRIKE_DEFAULT_CLOUD } from "@/lib/crowdstrike";

interface Props {
  clientId: string;
  hasClientSecret: boolean;
  baseUrl: string;
  scanEnabled: boolean;
  scanIntervalHours: number;
}

export function CrowdStrikeSettings({
  clientId: initialClientId,
  hasClientSecret,
  baseUrl: initialBaseUrl,
  scanEnabled: initialScanEnabled,
  scanIntervalHours: initialScanIntervalHours,
}: Props) {
  const router = useRouter();
  const [clientId, setClientId] = useState(initialClientId);
  const [clientSecret, setClientSecret] = useState("");
  const [baseUrl, setBaseUrl] = useState(
    initialBaseUrl || CROWDSTRIKE_DEFAULT_CLOUD
  );
  const [scanEnabled, setScanEnabled] = useState(initialScanEnabled);
  const [scanIntervalHours, setScanIntervalHours] = useState(
    initialScanIntervalHours
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [saveResult, setSaveResult] = useState<string | null>(null);

  const normalizedClientId = clientId.trim();
  const hasSecret = hasClientSecret || !!clientSecret.trim();
  const isConnected = !!normalizedClientId && hasSecret && !!baseUrl;
  const cloudLabel =
    CROWDSTRIKE_CLOUDS.find((c) => c.value === baseUrl)?.label ?? baseUrl;
  const checks = [
    { label: "Client ID", ok: !!normalizedClientId },
    { label: "Client secret", ok: hasSecret },
    { label: "API cloud", ok: !!baseUrl },
    { label: "Auto-scan", ok: scanEnabled },
  ];

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);
    try {
      const updates: Record<string, string | null> = {
        crowdstrike_client_id: normalizedClientId || null,
        crowdstrike_base_url: baseUrl,
        crowdstrike_scan_enabled: scanEnabled ? "true" : "false",
        crowdstrike_scan_interval_hours: String(scanIntervalHours),
      };
      if (clientSecret.trim()) {
        updates.crowdstrike_client_secret = clientSecret.trim();
      }

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (res.ok) {
        setSaveResult("Settings saved successfully.");
        setClientSecret("");
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
      setSaveResult(
        `Failed to save settings: ${
          err instanceof Error ? err.message : "Network error"
        }`
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test-crowdstrike", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setTestResult({
          success: false,
          message: data.error ?? `HTTP ${res.status}`,
        });
      } else {
        setTestResult({
          success: data.success,
          message: data.success ? data.message : data.error,
        });
      }
    } catch (err) {
      setTestResult({
        success: false,
        message: `Connection test failed: ${
          err instanceof Error ? err.message : "Network error"
        }`,
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleClearSecret() {
    if (!confirm("Remove the stored CrowdStrike client secret?")) return;
    setSaving(true);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ crowdstrike_client_secret: null }),
    });
    setSaving(false);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-[var(--accent)]" />
          CrowdStrike Falcon Configuration
        </CardTitle>
        <CardDescription>
          Connect to CrowdStrike Falcon to discover AI applications installed
          across managed endpoints via Falcon Discover.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div
          className="flex items-center gap-3 rounded-xl border px-5 py-4"
          style={{
            borderColor: isConnected
              ? "rgba(16, 185, 129, 0.2)"
              : "rgba(245, 158, 11, 0.2)",
            background: isConnected
              ? "rgba(16, 185, 129, 0.05)"
              : "rgba(245, 158, 11, 0.05)",
          }}
        >
          {isConnected ? (
            <>
              <Wifi className="h-5 w-5 text-[var(--success)]" />
              <div>
                <p className="text-sm font-medium text-[var(--success)]">
                  CrowdStrike Connected
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  Endpoint scanning is available on {cloudLabel}.
                </p>
              </div>
            </>
          ) : (
            <>
              <WifiOff className="h-5 w-5 text-[var(--warning)]" />
              <div>
                <p className="text-sm font-medium text-[var(--warning)]">
                  CrowdStrike Not Configured
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  Add an API client ID, secret, and cloud to scan managed
                  endpoints for installed AI apps.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
            CrowdStrike Health Checklist
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {checks.map((check) => (
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
              In the Falcon console, go to Support &amp; resources &gt; API
              clients and keys, and create an API client.
            </li>
            <li className="flex gap-2">
              <span className="text-[var(--accent)] font-bold shrink-0">2.</span>
              Grant it the{" "}
              <code className="font-mono text-[var(--accent)]">
                Falcon Discover: Read
              </code>{" "}
              scope (requires the Falcon Discover / Exposure Management module).
            </li>
            <li className="flex gap-2">
              <span className="text-[var(--accent)] font-bold shrink-0">3.</span>
              Paste the client ID and secret below and select your API cloud.
              UrNammu reads application inventory only.
            </li>
          </ol>
        </div>

        {/* Client ID */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <KeyRound className="h-3.5 w-3.5" />
            Client ID
          </Label>
          <Input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Falcon API client ID"
          />
        </div>

        {/* Client Secret */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <KeyRound className="h-3.5 w-3.5" />
            Client Secret
          </Label>
          {hasClientSecret ? (
            <div className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-3">
              <Check className="h-4 w-4 text-[var(--success)]" />
              <span className="text-sm text-[var(--text-muted)] flex-1">
                CrowdStrike client secret is configured
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleClearSecret}
                disabled={saving}
              >
                <X className="h-3 w-3 mr-1" /> Remove
              </Button>
            </div>
          ) : null}
          <Input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={
              hasClientSecret
                ? "Paste a new secret to replace the stored one"
                : "Paste your Falcon API client secret"
            }
          />
          <p className="text-[10px] text-[var(--text-faint)]">
            The secret is stored encrypted in the database and used only for
            CrowdStrike endpoint scanning.
          </p>
        </div>

        {/* API Cloud */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Globe className="h-3.5 w-3.5" />
            API Cloud
          </Label>
          <select
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
          >
            {CROWDSTRIKE_CLOUDS.map((cloud) => (
              <option key={cloud.value} value={cloud.value}>
                {cloud.label}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-[var(--text-faint)]">
            Match the region your Falcon tenant is hosted in.
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
              <option value="true">Enabled</option>
            </select>
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
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-[var(--border-subtle)]">
          <Button
            onClick={handleSave}
            disabled={saving || !normalizedClientId || !baseUrl}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {saving ? "Saving..." : "Save CrowdStrike Configuration"}
          </Button>
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={testing || !normalizedClientId || !hasSecret || !baseUrl}
          >
            {testing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Wifi className="mr-2 h-4 w-4" />
            )}
            {testing ? "Testing..." : "Test Connection"}
          </Button>
        </div>

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
  );
}
