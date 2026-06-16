"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  X,
  Loader2,
  Wifi,
  WifiOff,
  KeyRound,
  Eye,
  Clock,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export interface ProviderConfig {
  id: string;
  name: string;
  description: string;
  keyPlaceholder: string;
  testEndpoint: string;
  settingKey: string;
  hasKey: boolean;
  setupSteps: string[];
  docsUrl: string;
  docsLabel: string;
  credentialLabel?: string;
  color: string;
}

export const PROVIDERS: ProviderConfig[] = [
  {
    id: "anthropic",
    name: "Anthropic Admin API",
    description: "Access organization usage reports, API key inventory, workspace members, and audit data from your Anthropic account.",
    keyPlaceholder: "sk-ant-admin-...",
    testEndpoint: "/api/settings/test-anthropic-admin",
    settingKey: "anthropic_admin_key",
    hasKey: false,
    setupSteps: [
      "Go to console.anthropic.com > Settings > Admin API keys",
      "Create a new Admin API key",
      "Copy the key and paste it below",
    ],
    docsUrl: "https://docs.anthropic.com/en/api/administration-api",
    docsLabel: "Anthropic Admin API Docs",
    color: "var(--accent)",
  },
  {
    id: "openai",
    name: "OpenAI Admin API",
    description: "Access organization usage, costs, API key inventory, and auto-discover OpenAI Assistants as AI agents.",
    keyPlaceholder: "sk-admin-...",
    testEndpoint: "/api/settings/test-openai-admin",
    settingKey: "openai_admin_key",
    hasKey: false,
    setupSteps: [
      "Go to platform.openai.com > Settings > Organization > Admin API keys",
      "Create a new admin key (requires Organization Owner role)",
      "Copy the key and paste it below",
    ],
    docsUrl: "https://platform.openai.com/docs/api-reference/admin-api-keys",
    docsLabel: "OpenAI Admin API Docs",
    color: "var(--success)",
  },
  {
    id: "cursor",
    name: "Cursor Admin API",
    description: "Pull team daily usage, per-member spend, and granular usage events (with cost) from Cursor and normalize them into Oversight usage and cost buckets. Complements the OTel hook (activity), which carries no cost.",
    keyPlaceholder: "key_...",
    testEndpoint: "/api/settings/test-cursor-admin",
    settingKey: "cursor_admin_key",
    hasKey: false,
    setupSteps: [
      "Go to cursor.com > Dashboard > Settings > Cursor Admin API Keys (team admins only)",
      "Create a new admin API key",
      "Copy the key and paste it below",
    ],
    docsUrl: "https://cursor.com/docs/account/teams/admin-api",
    docsLabel: "Cursor Admin API Docs",
    color: "var(--accent)",
  },
  {
    id: "openrouter",
    name: "OpenRouter Activity API",
    description: "Pull daily proxy activity from OpenRouter using a provisioning key and normalize it into Oversight usage and cost buckets.",
    keyPlaceholder: "or-...",
    testEndpoint: "/api/settings/test-openrouter",
    settingKey: "openrouter_provisioning_key",
    hasKey: false,
    setupSteps: [
      "Go to openrouter.ai settings and create a provisioning key",
      "Grant the key access to analytics / activity data",
      "Copy the key and paste it below",
    ],
    docsUrl: "https://openrouter.ai/docs/api-reference/analytics/get-activity",
    docsLabel: "OpenRouter Activity API Docs",
    credentialLabel: "Provisioning Key",
    color: "var(--accent)",
  },
  {
    id: "helicone",
    name: "Helicone Request API",
    description: "Read Helicone request logs and aggregate them into UrNammu telemetry for third-party proxy oversight.",
    keyPlaceholder: "sk-helicone-...",
    testEndpoint: "/api/settings/test-helicone",
    settingKey: "helicone_api_key",
    hasKey: false,
    setupSteps: [
      "Go to your Helicone dashboard and generate an API key",
      "If you use the EU region, set HELICONE_API_BASE_URL separately to https://eu.api.helicone.ai",
      "Copy the API key and paste it below",
    ],
    docsUrl: "https://docs.helicone.ai/guides/cookbooks/getting-user-requests",
    docsLabel: "Helicone Request API Docs",
    credentialLabel: "API Key",
    color: "var(--warning)",
  },
  {
    id: "portkey",
    name: "Portkey Analytics API",
    description: "Sync Portkey gateway analytics into UrNammu using a Portkey admin or workspace API key.",
    keyPlaceholder: "pk_live_...",
    testEndpoint: "/api/settings/test-portkey",
    settingKey: "portkey_api_key",
    hasKey: false,
    setupSteps: [
      "Go to Portkey and create an API key with analytics access",
      "Grant analytics scopes, and logs scopes if you plan to export richer data later",
      "Paste the API key below. Optionally set PORTKEY_WORKSPACE_SLUG separately for a non-default workspace.",
    ],
    docsUrl: "https://portkey.ai/docs/api-reference/admin-api/introduction",
    docsLabel: "Portkey Admin API Docs",
    credentialLabel: "API Key",
    color: "var(--success)",
  },
  {
    id: "litellm",
    name: "LiteLLM Proxy",
    description: "Pull spend logs and team usage from a self-hosted LiteLLM proxy so UrNammu can attribute gateway traffic back to projects and actors.",
    keyPlaceholder: "sk-litellm-...",
    testEndpoint: "/api/settings/test-litellm",
    settingKey: "litellm_api_key",
    hasKey: false,
    setupSteps: [
      "Deploy the LiteLLM proxy (self-hosted) and note its base URL.",
      "Generate a master key (sk-...) on that proxy or grab one from your secret store.",
      "Paste the master key below and set litellm_api_base_url to the proxy URL (e.g., https://litellm.internal).",
    ],
    docsUrl: "https://docs.litellm.ai/docs/proxy/ui_logs_spend",
    docsLabel: "LiteLLM Proxy Spend Logs Docs",
    credentialLabel: "Master Key",
    color: "var(--accent)",
  },
];

interface Props {
  hasAnthropicAdminKey: boolean;
  hasCursorAdminKey: boolean;
  hasOpenAIAdminKey: boolean;
  hasOpenRouterKey: boolean;
  hasHeliconeKey: boolean;
  hasPortkeyKey: boolean;
  hasLiteLLMKey: boolean;
  hasGeminiBillingConfig: boolean;
  providerSyncEnabled: boolean;
  providerSyncIntervalHours: number;
  geminiBillingProjectId: string;
  geminiBillingDataset: string;
  geminiBillingTable: string;
  geminiBillingLocation: string;
  anomalyRecentWindowDays: number;
  anomalyBaselineWindowDays: number;
  anomalyMinRecentTokens: number;
  anomalyMinRecentCost: number;
  anomalyProviderMultiplier: number;
  anomalyModelMultiplier: number;
  anomalyProjectMultiplier: number;
  governanceReviewNoticeDays: number;
  governanceExceptionNoticeDays: number;
  governanceEscalationOverdueDays: number;
  anthropicManagedSystemId: string;
  aiSystems: { id: string; name: string; vendor: string | null }[];
}

export function AdminAPISettings({
  hasAnthropicAdminKey,
  hasCursorAdminKey,
  hasOpenAIAdminKey,
  hasOpenRouterKey,
  hasHeliconeKey,
  hasPortkeyKey,
  hasLiteLLMKey,
  hasGeminiBillingConfig,
  providerSyncEnabled: initialProviderSyncEnabled,
  providerSyncIntervalHours: initialProviderSyncIntervalHours,
  geminiBillingProjectId: initialGeminiBillingProjectId,
  geminiBillingDataset: initialGeminiBillingDataset,
  geminiBillingTable: initialGeminiBillingTable,
  geminiBillingLocation: initialGeminiBillingLocation,
  anomalyRecentWindowDays: initialAnomalyRecentWindowDays,
  anomalyBaselineWindowDays: initialAnomalyBaselineWindowDays,
  anomalyMinRecentTokens: initialAnomalyMinRecentTokens,
  anomalyMinRecentCost: initialAnomalyMinRecentCost,
  anomalyProviderMultiplier: initialAnomalyProviderMultiplier,
  anomalyModelMultiplier: initialAnomalyModelMultiplier,
  anomalyProjectMultiplier: initialAnomalyProjectMultiplier,
  governanceReviewNoticeDays: initialGovernanceReviewNoticeDays,
  governanceExceptionNoticeDays: initialGovernanceExceptionNoticeDays,
  governanceEscalationOverdueDays: initialGovernanceEscalationOverdueDays,
  anthropicManagedSystemId: initialAnthropicManagedSystemId,
  aiSystems,
}: Props) {
  const router = useRouter();
  const [providerSyncEnabled, setProviderSyncEnabled] = useState(initialProviderSyncEnabled);
  const [providerSyncIntervalHours, setProviderSyncIntervalHours] = useState(initialProviderSyncIntervalHours);
  const [geminiBillingProjectId, setGeminiBillingProjectId] = useState(initialGeminiBillingProjectId);
  const [geminiBillingDataset, setGeminiBillingDataset] = useState(initialGeminiBillingDataset);
  const [geminiBillingTable, setGeminiBillingTable] = useState(initialGeminiBillingTable);
  const [geminiBillingLocation, setGeminiBillingLocation] = useState(initialGeminiBillingLocation);
  const [geminiServiceAccountKey, setGeminiServiceAccountKey] = useState("");
  const [savingGemini, setSavingGemini] = useState(false);
  const [testingGemini, setTestingGemini] = useState(false);
  const [geminiSaveResult, setGeminiSaveResult] = useState<string | null>(null);
  const [geminiTestResult, setGeminiTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [anomalyRecentWindowDays, setAnomalyRecentWindowDays] = useState(initialAnomalyRecentWindowDays);
  const [anomalyBaselineWindowDays, setAnomalyBaselineWindowDays] = useState(initialAnomalyBaselineWindowDays);
  const [anomalyMinRecentTokens, setAnomalyMinRecentTokens] = useState(initialAnomalyMinRecentTokens);
  const [anomalyMinRecentCost, setAnomalyMinRecentCost] = useState(initialAnomalyMinRecentCost);
  const [anomalyProviderMultiplier, setAnomalyProviderMultiplier] = useState(initialAnomalyProviderMultiplier);
  const [anomalyModelMultiplier, setAnomalyModelMultiplier] = useState(initialAnomalyModelMultiplier);
  const [anomalyProjectMultiplier, setAnomalyProjectMultiplier] = useState(initialAnomalyProjectMultiplier);
  const [governanceReviewNoticeDays, setGovernanceReviewNoticeDays] = useState(initialGovernanceReviewNoticeDays);
  const [governanceExceptionNoticeDays, setGovernanceExceptionNoticeDays] = useState(initialGovernanceExceptionNoticeDays);
  const [governanceEscalationOverdueDays, setGovernanceEscalationOverdueDays] = useState(initialGovernanceEscalationOverdueDays);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleResult, setScheduleResult] = useState<string | null>(null);
  const [anthropicManagedSystemId, setAnthropicManagedSystemId] = useState(initialAnthropicManagedSystemId);
  const [savingAttribution, setSavingAttribution] = useState(false);
  const [attributionResult, setAttributionResult] = useState<string | null>(null);

  const providers = PROVIDERS.map((p) => ({
    ...p,
    hasKey:
      p.id === "anthropic"
        ? hasAnthropicAdminKey
        : p.id === "cursor"
          ? hasCursorAdminKey
          : p.id === "openai"
            ? hasOpenAIAdminKey
            : p.id === "openrouter"
              ? hasOpenRouterKey
              : p.id === "helicone"
                ? hasHeliconeKey
                : p.id === "portkey"
                  ? hasPortkeyKey
                  : p.id === "litellm"
                    ? hasLiteLLMKey
                    : false,
  }));

  async function handleSaveSchedule() {
    setSavingSchedule(true);
    setScheduleResult(null);

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider_sync_enabled: providerSyncEnabled ? "true" : "false",
          provider_sync_interval_hours: String(providerSyncIntervalHours),
          anomaly_recent_window_days: String(anomalyRecentWindowDays),
          anomaly_baseline_window_days: String(anomalyBaselineWindowDays),
          anomaly_min_recent_tokens: String(anomalyMinRecentTokens),
          anomaly_min_recent_cost: String(anomalyMinRecentCost),
          anomaly_provider_multiplier: String(anomalyProviderMultiplier),
          anomaly_model_multiplier: String(anomalyModelMultiplier),
          anomaly_project_multiplier: String(anomalyProjectMultiplier),
          governance_review_notice_days: String(governanceReviewNoticeDays),
          governance_exception_notice_days: String(governanceExceptionNoticeDays),
          governance_escalation_overdue_days: String(governanceEscalationOverdueDays),
        }),
      });

      if (res.ok) {
        setScheduleResult("Provider sync, anomaly, and governance automation settings saved.");
        router.refresh();
      } else {
        const text = await res.text();
        let msg = `HTTP ${res.status}`;
        try { msg = JSON.parse(text).error ?? msg; } catch { msg = text || msg; }
        setScheduleResult(`Failed: ${msg}`);
      }
    } catch (err) {
      setScheduleResult(`Failed: ${err instanceof Error ? err.message : "Network error"}`);
    } finally {
      setSavingSchedule(false);
    }
  }

  async function handleSaveGemini() {
    setSavingGemini(true);
    setGeminiSaveResult(null);

    try {
      const payload: Record<string, string> = {
        gemini_billing_project_id: geminiBillingProjectId.trim(),
        gemini_billing_dataset: geminiBillingDataset.trim(),
        gemini_billing_table: geminiBillingTable.trim(),
        gemini_billing_location: geminiBillingLocation.trim() || "US",
      };

      if (geminiServiceAccountKey.trim()) {
        payload.gemini_billing_service_account_key = geminiServiceAccountKey.trim();
      }

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setGeminiSaveResult("Gemini billing settings saved.");
        setGeminiServiceAccountKey("");
        router.refresh();
      } else {
        const text = await res.text();
        let msg = `HTTP ${res.status}`;
        try { msg = JSON.parse(text).error ?? msg; } catch { msg = text || msg; }
        setGeminiSaveResult(`Failed: ${msg}`);
      }
    } catch (err) {
      setGeminiSaveResult(`Failed: ${err instanceof Error ? err.message : "Network error"}`);
    } finally {
      setSavingGemini(false);
    }
  }

  async function handleSaveAttribution() {
    setSavingAttribution(true);
    setAttributionResult(null);

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anthropic_managed_system_id: anthropicManagedSystemId || null,
        }),
      });

      if (res.ok) {
        setAttributionResult("Attribution settings saved.");
        router.refresh();
      } else {
        const text = await res.text();
        let msg = `HTTP ${res.status}`;
        try { msg = JSON.parse(text).error ?? msg; } catch { msg = text || msg; }
        setAttributionResult(`Failed: ${msg}`);
      }
    } catch (err) {
      setAttributionResult(`Failed: ${err instanceof Error ? err.message : "Network error"}`);
    } finally {
      setSavingAttribution(false);
    }
  }

  async function handleTestGemini() {
    setTestingGemini(true);
    setGeminiTestResult(null);
    try {
      const res = await fetch("/api/settings/test-gemini-billing", { method: "POST" });
      const data = await res.json();
      setGeminiTestResult(res.ok ? data : { success: false, message: data.error ?? `HTTP ${res.status}` });
    } catch {
      setGeminiTestResult({ success: false, message: "Test failed." });
    } finally {
      setTestingGemini(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-[var(--accent)]" />
          AI Provider Admin APIs
        </CardTitle>
        <CardDescription>
          Connect provider admin APIs and major proxy platforms to pull organization-level usage, costs, and gateway activity into AI Oversight.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 space-y-4">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-[var(--accent)]" />
            <div>
              <h4 className="text-sm font-semibold">Background Provider Sync</h4>
              <p className="text-xs text-[var(--text-muted)]">
                Lets the shared maintenance scheduler refresh provider telemetry and assistant inventory without manual button presses.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs">Auto-sync</Label>
              <select
                value={providerSyncEnabled ? "true" : "false"}
                onChange={(e) => setProviderSyncEnabled(e.target.value === "true")}
                className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
              >
                <option value="false">Disabled</option>
                <option value="true">Enabled</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-xs">
                <Clock className="h-3 w-3" />
                Sync Interval
              </Label>
              <select
                value={String(providerSyncIntervalHours)}
                onChange={(e) => setProviderSyncIntervalHours(parseInt(e.target.value, 10))}
                className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
              >
                <option value="1">Every hour</option>
                <option value="6">Every 6 hours</option>
                <option value="12">Every 12 hours</option>
                <option value="24">Every 24 hours</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleSaveSchedule} disabled={savingSchedule}>
              {savingSchedule ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
              {savingSchedule ? "Saving..." : "Save Sync Schedule"}
            </Button>
            {scheduleResult && (
              <span className={`text-xs ${scheduleResult.includes("saved") ? "text-[var(--success)]" : "text-[var(--critical)]"}`}>
                {scheduleResult}
              </span>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-[var(--accent)]" />
            <div>
              <h4 className="text-sm font-semibold">Anomaly Detection</h4>
              <p className="text-xs text-[var(--text-muted)]">
                Tune the baseline windows and spike thresholds used by AI Oversight anomaly detection.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label className="text-xs">Recent Window (days)</Label>
              <Input type="number" min={1} value={anomalyRecentWindowDays} onChange={(e) => setAnomalyRecentWindowDays(parseInt(e.target.value || "1", 10))} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Baseline Window (days)</Label>
              <Input type="number" min={1} value={anomalyBaselineWindowDays} onChange={(e) => setAnomalyBaselineWindowDays(parseInt(e.target.value || "1", 10))} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Minimum Recent Tokens</Label>
              <Input type="number" min={1} value={anomalyMinRecentTokens} onChange={(e) => setAnomalyMinRecentTokens(parseInt(e.target.value || "1", 10))} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Minimum Recent Cost</Label>
              <Input type="number" min={0.01} step="0.01" value={anomalyMinRecentCost} onChange={(e) => setAnomalyMinRecentCost(parseFloat(e.target.value || "0.01"))} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Provider Spike Multiplier</Label>
              <Input type="number" min={1.1} step="0.1" value={anomalyProviderMultiplier} onChange={(e) => setAnomalyProviderMultiplier(parseFloat(e.target.value || "1.1"))} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Model Spike Multiplier</Label>
              <Input type="number" min={1.1} step="0.1" value={anomalyModelMultiplier} onChange={(e) => setAnomalyModelMultiplier(parseFloat(e.target.value || "1.1"))} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Project Spike Multiplier</Label>
              <Input type="number" min={1.1} step="0.1" value={anomalyProjectMultiplier} onChange={(e) => setAnomalyProjectMultiplier(parseFloat(e.target.value || "1.1"))} />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-[var(--accent)]" />
            <div>
              <h4 className="text-sm font-semibold">Governance Renewal Automation</h4>
              <p className="text-xs text-[var(--text-muted)]">
                Control when scheduled maintenance creates renewal reminders and ownership escalation alerts.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label className="text-xs">Review Notice (days)</Label>
              <Input type="number" min={1} value={governanceReviewNoticeDays} onChange={(e) => setGovernanceReviewNoticeDays(parseInt(e.target.value || "1", 10))} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Exception Notice (days)</Label>
              <Input type="number" min={1} value={governanceExceptionNoticeDays} onChange={(e) => setGovernanceExceptionNoticeDays(parseInt(e.target.value || "1", 10))} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Escalate After Overdue (days)</Label>
              <Input type="number" min={1} value={governanceEscalationOverdueDays} onChange={(e) => setGovernanceEscalationOverdueDays(parseInt(e.target.value || "1", 10))} />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-[var(--accent)]" />
            <div>
              <h4 className="text-sm font-semibold">Usage Attribution</h4>
              <p className="text-xs text-[var(--text-muted)]">
                Pick the registered AI system that admin-sync&apos;d telemetry should be attributed to. Without this, rows fall back to api-key-level labels.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Anthropic managed system</Label>
            <select
              value={anthropicManagedSystemId}
              onChange={(e) => setAnthropicManagedSystemId(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
            >
              <option value="">— Not set (unattributed) —</option>
              {aiSystems.map((sys) => (
                <option key={sys.id} value={sys.id}>
                  {sys.name}{sys.vendor ? ` (${sys.vendor})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleSaveAttribution} disabled={savingAttribution}>
              {savingAttribution ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
              {savingAttribution ? "Saving..." : "Save Attribution Settings"}
            </Button>
            {attributionResult && (
              <span className={`text-xs ${attributionResult.includes("saved") ? "text-[var(--success)]" : "text-[var(--critical)]"}`}>
                {attributionResult}
              </span>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                Google Gemini via Cloud Billing Export
              </h4>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Pull Gemini and Vertex AI oversight cost data from a Google Cloud Billing export table in BigQuery.
              </p>
            </div>
            {hasGeminiBillingConfig ? (
              <div className="flex items-center gap-1.5 text-xs text-[var(--success)]">
                <Wifi className="h-3.5 w-3.5" /> Configured
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-faint)]">
                <WifiOff className="h-3.5 w-3.5" /> Not configured
              </div>
            )}
          </div>

          <div className="rounded-md bg-[var(--bg-base)] p-3">
            <ol className="space-y-1 text-xs text-[var(--text-muted)]">
              <li className="flex gap-2"><span className="font-bold shrink-0" style={{ color: "var(--accent)" }}>1.</span> Enable Cloud Billing export to BigQuery for the billing account that covers Gemini / Vertex AI usage.</li>
              <li className="flex gap-2"><span className="font-bold shrink-0" style={{ color: "var(--accent)" }}>2.</span> Create a Google Cloud service account with BigQuery read access to that dataset.</li>
              <li className="flex gap-2"><span className="font-bold shrink-0" style={{ color: "var(--accent)" }}>3.</span> Paste the service account JSON plus the BigQuery project, dataset, and billing export table below.</li>
            </ol>
            <a
              href="https://cloud.google.com/billing/docs/how-to/export-data-bigquery-tables"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[10px] text-[var(--accent)] hover:underline"
            >
              Google Cloud Billing Export Docs
            </a>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs">Billing Project ID</Label>
              <Input value={geminiBillingProjectId} onChange={(e) => setGeminiBillingProjectId(e.target.value)} placeholder="my-gcp-project" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">BigQuery Dataset</Label>
              <Input value={geminiBillingDataset} onChange={(e) => setGeminiBillingDataset(e.target.value)} placeholder="billing_export" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Billing Export Table</Label>
              <Input value={geminiBillingTable} onChange={(e) => setGeminiBillingTable(e.target.value)} placeholder="gcp_billing_export_v1_..." />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">BigQuery Location</Label>
              <Input value={geminiBillingLocation} onChange={(e) => setGeminiBillingLocation(e.target.value)} placeholder="US" />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-xs">
              <KeyRound className="h-3 w-3" />
              Service Account JSON
            </Label>
            {hasGeminiBillingConfig && !geminiServiceAccountKey ? (
              <div className="flex items-center gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2">
                <Check className="h-3.5 w-3.5 text-[var(--success)]" />
                <span className="text-xs text-[var(--text-muted)] flex-1">Service account key configured</span>
                <Button size="sm" variant="ghost" onClick={() => setGeminiServiceAccountKey(" ")} className="text-xs h-6 px-2">
                  Replace
                </Button>
              </div>
            ) : (
                <Input
                  type="password"
                  value={geminiServiceAccountKey.trim()}
                  onChange={(e) => setGeminiServiceAccountKey(e.target.value)}
                  placeholder='{"type":"service_account", ...}'
                  className="font-mono text-xs"
                />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={handleSaveGemini} disabled={savingGemini}>
              {savingGemini ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
              {savingGemini ? "Saving..." : "Save Gemini Settings"}
            </Button>
            <Button size="sm" variant="outline" onClick={handleTestGemini} disabled={testingGemini || !hasGeminiBillingConfig}>
              {testingGemini ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
              {testingGemini ? "Testing..." : "Test Gemini Connection"}
            </Button>
            {geminiSaveResult ? (
              <span className={`text-xs ${geminiSaveResult.includes("saved") ? "text-[var(--success)]" : "text-[var(--critical)]"}`}>
                {geminiSaveResult}
              </span>
            ) : null}
            {geminiTestResult ? (
              <span className={`text-xs ${geminiTestResult.success ? "text-[var(--success)]" : "text-[var(--critical)]"}`}>
                {geminiTestResult.message}
              </span>
            ) : null}
          </div>
        </div>

        {providers.map((provider) => (
          <ProviderSection key={provider.id} provider={provider} />
        ))}
      </CardContent>
    </Card>
  );
}

export function ProviderSection({ provider }: { provider: ProviderConfig & { hasKey: boolean } }) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saveResult, setSaveResult] = useState<string | null>(null);

  async function handleSave() {
    if (!apiKey.trim()) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [provider.settingKey]: apiKey.trim() }),
      });
      if (res.ok) {
        setSaveResult("Saved.");
        setApiKey("");
        router.refresh();
      } else {
        const text = await res.text();
        let msg = `HTTP ${res.status}`;
        try { msg = JSON.parse(text).error ?? msg; } catch { msg = text || msg; }
        setSaveResult(`Failed: ${msg}`);
      }
    } catch {
      setSaveResult("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(provider.testEndpoint, { method: "POST" });
      const data = await res.json();
      setTestResult(res.ok ? data : { success: false, message: data.error ?? `HTTP ${res.status}` });
    } catch {
      setTestResult({ success: false, message: "Test failed." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">{provider.name}</h4>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{provider.description}</p>
        </div>
        {provider.hasKey ? (
          <div className="flex items-center gap-1.5 text-xs text-[var(--success)]">
            <Wifi className="h-3.5 w-3.5" /> Connected
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-faint)]">
            <WifiOff className="h-3.5 w-3.5" /> Not configured
          </div>
        )}
      </div>

      {/* Setup steps */}
      <div className="rounded-md bg-[var(--bg-base)] p-3">
        <ol className="space-y-1 text-xs text-[var(--text-muted)]">
          {provider.setupSteps.map((step, i) => (
            <li key={i} className="flex gap-2">
              <span className="font-bold shrink-0" style={{ color: provider.color }}>{i + 1}.</span>
              {step}
            </li>
          ))}
        </ol>
        <a
          href={provider.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[10px] text-[var(--accent)] hover:underline"
        >
          {provider.docsLabel}
        </a>
      </div>

      {/* Key input */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-xs">
          <KeyRound className="h-3 w-3" />
          {provider.credentialLabel ?? "API Key"}
        </Label>
        {provider.hasKey && !apiKey ? (
          <div className="flex items-center gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2">
            <Check className="h-3.5 w-3.5 text-[var(--success)]" />
            <span className="text-xs text-[var(--text-muted)] flex-1">Key configured</span>
            <Button size="sm" variant="ghost" onClick={() => setApiKey(" ")} className="text-xs h-6 px-2">
              Replace
            </Button>
          </div>
        ) : (
          <Input
            type="password"
            value={apiKey.trim()}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={provider.keyPlaceholder}
            className="font-mono text-xs"
          />
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving || !apiKey.trim()}>
          {saving ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button size="sm" variant="outline" onClick={handleTest} disabled={testing || !provider.hasKey}>
          {testing ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Wifi className="mr-1.5 h-3 w-3" />}
          {testing ? "Testing..." : "Test"}
        </Button>
        {saveResult && (
          <span className={`text-xs ${saveResult.includes("Saved") ? "text-[var(--success)]" : "text-[var(--critical)]"}`}>
            {saveResult}
          </span>
        )}
      </div>

      {testResult && (
        <div
          className="flex items-start gap-2 rounded-md border p-3"
          style={{
            borderColor: testResult.success ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)",
            background: testResult.success ? "rgba(16,185,129,0.05)" : "rgba(239,68,68,0.05)",
          }}
        >
          {testResult.success ? (
            <Check className="h-3.5 w-3.5 text-[var(--success)] mt-0.5 shrink-0" />
          ) : (
            <X className="h-3.5 w-3.5 text-[var(--critical)] mt-0.5 shrink-0" />
          )}
          <p className="text-xs" style={{ color: testResult.success ? "var(--success)" : "var(--critical)" }}>
            {testResult.message}
          </p>
        </div>
      )}
    </div>
  );
}
