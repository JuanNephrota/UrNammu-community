"use client";

import { useEffect, useRef, useState } from "react";
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
  History,
} from "lucide-react";
import {
  addDays,
  BACKFILL_CHUNK_DAYS,
  buildBackfillChunks,
  PROVIDER_MAX_LOOKBACK_DAYS,
  SYNC_PROVIDER_LABELS,
  SYNC_PROVIDERS,
  type SyncProvider,
} from "@/lib/provider-sync-window";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { GitHubCopilotSettings } from "@/components/settings/github-copilot-settings";

/** Serialisable view of `ProviderSyncStatus` (Dates as ISO strings). */
export type ProviderSyncStatusView = {
  provider: string;
  label: string;
  configured: boolean;
  enabled: boolean;
  enabledSource: "provider" | "global" | "default";
  intervalHours: number;
  intervalSource: "provider" | "global" | "default";
  due: boolean;
  nextDueAt: string | null;
  skippedReason?: string;
  overrideEnabled: string | null;
  overrideIntervalHours: string | null;
  lastRun: {
    status: string;
    startedAt: string;
    completedAt: string | null;
    errorMessage: string | null;
    recordsProcessed: number;
  } | null;
  lastSucceededAt: string | null;
};

const INTERVAL_OPTIONS = [1, 6, 12, 24] as const;

function formatRelative(iso: string | null, now: number): string {
  if (!iso) return "never";
  const diffMs = now - new Date(iso).getTime();
  const abs = Math.abs(diffMs);
  const suffix = diffMs >= 0 ? "ago" : "from now";
  const minutes = Math.round(abs / 60000);
  if (minutes < 1) return diffMs >= 0 ? "just now" : "in under a minute";
  if (minutes < 60) return `${minutes} min ${suffix}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ${suffix}`;
  return `${Math.round(hours / 24)} d ${suffix}`;
}

function runStatusVariant(status: string): "success" | "critical" | "info" | "default" {
  if (status === "SUCCEEDED") return "success";
  if (status === "FAILED") return "critical";
  if (status === "RUNNING") return "info";
  return "default";
}
import {
  serializeProviderKeySystemMap,
  type KeyMappableProvider,
  type ProviderKeySystemMap,
} from "@/lib/system-attribution";

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

export interface ProviderSyncWatermarkView {
  provider: string;
  /** ISO — last UTC day fully ingested. */
  watermark: string;
  /** ISO — earliest day ever ingested. */
  earliest: string;
  updatedAt: string;
}

/** Which ProviderSyncJobResult counters belong to each provider. */
const BACKFILL_RESULT_KEYS: Record<SyncProvider, { usage: string; cost: string }> = {
  anthropic: { usage: "anthropicUsageSynced", cost: "anthropicCostBucketsSynced" },
  openai: { usage: "openaiUsageSynced", cost: "openaiCostBucketsSynced" },
  openrouter: { usage: "openRouterUsageSynced", cost: "openRouterCostBucketsSynced" },
  helicone: { usage: "heliconeUsageSynced", cost: "heliconeCostBucketsSynced" },
  portkey: { usage: "portkeyUsageSynced", cost: "portkeyCostBucketsSynced" },
  litellm: { usage: "litellmUsageSynced", cost: "litellmCostBucketsSynced" },
  gemini: { usage: "geminiUsageSynced", cost: "geminiCostBucketsSynced" },
  claude_code: { usage: "claudeCodeUsageSynced", cost: "claudeCodeCostsSynced" },
  cursor: { usage: "cursorUsageSynced", cost: "cursorCostBucketsSynced" },
  github_copilot: { usage: "githubCopilotUsageSynced", cost: "githubCopilotCostBucketsSynced" },
  chatgpt_enterprise: { usage: "chatgptEnterpriseUsageSynced", cost: "chatgptEnterpriseCostBucketsSynced" },
};

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

interface Props {
  hasAnthropicAdminKey: boolean;
  hasCursorAdminKey: boolean;
  hasGitHubCopilotConfig: boolean;
  githubCopilot: { org: string; enterprise: string; hasToken: boolean };
  hasChatGPTEnterpriseConfig: boolean;
  hasOpenAIAdminKey: boolean;
  hasOpenRouterKey: boolean;
  hasHeliconeKey: boolean;
  hasPortkeyKey: boolean;
  hasLiteLLMKey: boolean;
  hasGeminiBillingConfig: boolean;
  providerSyncEnabled: boolean;
  providerSyncIntervalHours: number;
  providerSyncStatuses: ProviderSyncStatusView[];
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
  openaiManagedSystemId: string;
  litellmManagedSystemId: string;
  /** `{ [provider]: { [apiKeyExternalId]: aiSystemId } }` — per-key overrides. */
  keySystemMap: ProviderKeySystemMap;
  /** Provider API keys seen in recent telemetry, for the per-key editor. */
  knownApiKeys: { provider: string; apiKeyExternalId: string; apiKeyName: string | null }[];
  aiSystems: { id: string; name: string; vendor: string | null }[];
  watermarks: ProviderSyncWatermarkView[];
}

const KEY_MAPPABLE_PROVIDER_LABELS: Record<KeyMappableProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  litellm: "LiteLLM",
};

export function AdminAPISettings({
  hasAnthropicAdminKey,
  hasCursorAdminKey,
  hasGitHubCopilotConfig,
  githubCopilot,
  hasChatGPTEnterpriseConfig,
  hasOpenAIAdminKey,
  hasOpenRouterKey,
  hasHeliconeKey,
  hasPortkeyKey,
  hasLiteLLMKey,
  hasGeminiBillingConfig,
  providerSyncEnabled: initialProviderSyncEnabled,
  providerSyncIntervalHours: initialProviderSyncIntervalHours,
  providerSyncStatuses,
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
  openaiManagedSystemId: initialOpenaiManagedSystemId,
  litellmManagedSystemId: initialLitellmManagedSystemId,
  keySystemMap: initialKeySystemMap,
  knownApiKeys,
  aiSystems,
  watermarks,
}: Props) {
  const router = useRouter();
  const [providerSyncEnabled, setProviderSyncEnabled] = useState(initialProviderSyncEnabled);
  const [providerSyncIntervalHours, setProviderSyncIntervalHours] = useState(initialProviderSyncIntervalHours);
  // Per-provider overrides. "" means inherit the global value (the key is
  // deleted on save); "true"/"false" or an hour count means override.
  const [providerOverrides, setProviderOverrides] = useState<Record<string, { enabled: string; intervalHours: string }>>(
    () =>
      Object.fromEntries(
        providerSyncStatuses.map((status) => [
          status.provider,
          {
            enabled: status.overrideEnabled ?? "",
            intervalHours: status.overrideIntervalHours ?? "",
          },
        ])
      )
  );
  const [renderedAt] = useState(() => Date.now());
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
  const [openaiManagedSystemId, setOpenaiManagedSystemId] = useState(initialOpenaiManagedSystemId);
  const [litellmManagedSystemId, setLitellmManagedSystemId] = useState(initialLitellmManagedSystemId);
  const [keySystemMap, setKeySystemMap] = useState<ProviderKeySystemMap>(initialKeySystemMap);
  const [savingAttribution, setSavingAttribution] = useState(false);
  const [attributionResult, setAttributionResult] = useState<string | null>(null);
  const [backfillProvider, setBackfillProvider] = useState<SyncProvider>("anthropic");
  const [backfillFrom, setBackfillFrom] = useState("");
  const [backfillTo, setBackfillTo] = useState("");
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{ done: number; total: number; current: string | null } | null>(null);
  const [backfillLog, setBackfillLog] = useState<string[]>([]);
  const [backfillResult, setBackfillResult] = useState<{ ok: boolean; message: string } | null>(null);
  const backfillCancelRef = useRef(false);

  const providerConfigured: Record<SyncProvider, boolean> = {
    anthropic: hasAnthropicAdminKey,
    claude_code: hasAnthropicAdminKey,
    openai: hasOpenAIAdminKey,
    cursor: hasCursorAdminKey,
    github_copilot: hasGitHubCopilotConfig,
    gemini: hasGeminiBillingConfig,
    openrouter: hasOpenRouterKey,
    helicone: hasHeliconeKey,
    portkey: hasPortkeyKey,
    litellm: hasLiteLLMKey,
    chatgpt_enterprise: hasChatGPTEnterpriseConfig,
  };

  // Default the backfill range to the provider's full retention window.
  // Computed on the client after mount so server and client markup match.
  useEffect(() => {
    const now = new Date();
    setBackfillFrom(toDateInput(addDays(now, -PROVIDER_MAX_LOOKBACK_DAYS[backfillProvider])));
    setBackfillTo(toDateInput(now));
  }, [backfillProvider]);

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

  async function handleBackfill() {
    const provider = backfillProvider;
    const from = new Date(`${backfillFrom}T00:00:00.000Z`);
    const now = new Date();
    const toDayEnd = addDays(new Date(`${backfillTo}T00:00:00.000Z`), 1);
    const to = toDayEnd < now ? toDayEnd : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      setBackfillResult({ ok: false, message: "Pick a valid date range (start before end)." });
      return;
    }

    const chunks = buildBackfillChunks(from, to, BACKFILL_CHUNK_DAYS);
    const keys = BACKFILL_RESULT_KEYS[provider];
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    backfillCancelRef.current = false;
    setBackfillRunning(true);
    setBackfillResult(null);
    setBackfillLog([]);
    setBackfillProgress({ done: 0, total: chunks.length, current: null });

    let usage = 0;
    let cost = 0;
    let failures = 0;
    let truncatedChunks = 0;
    let stopped: string | null = null;

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (backfillCancelRef.current) {
          stopped = `Cancelled after ${i} of ${chunks.length} chunks.`;
          break;
        }
        const chunk = chunks[i]!;
        const label = `${fmt(chunk.from)} → ${fmt(chunk.to)}`;
        setBackfillProgress({ done: i, total: chunks.length, current: label });

        const res = await fetch("/api/admin-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            from: chunk.from.toISOString(),
            to: chunk.to.toISOString(),
          }),
        });
        const text = await res.text();
        let body: Record<string, unknown> = {};
        try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = {}; }

        if (!res.ok) {
          failures++;
          const msg = typeof body.error === "string" ? body.error : text.slice(0, 160);
          setBackfillLog((log) => [...log, `${label}: HTTP ${res.status} — ${msg}`]);
          if (res.status === 400 || res.status === 401 || res.status === 403) {
            stopped = "Stopped: the server rejected the request.";
            break;
          }
          continue;
        }

        const skipped = Array.isArray(body.skipped) ? (body.skipped as string[]) : [];
        if (skipped.length > 0) {
          setBackfillLog((log) => [...log, `${label}: ${skipped.join("; ")}`]);
          stopped = "Stopped: this provider is not configured, so there is nothing to backfill.";
          break;
        }

        const errors = Array.isArray(body.errors) ? (body.errors as string[]) : [];
        if (errors.length > 0) {
          failures++;
          setBackfillLog((log) => [...log, `${label}: ${errors.join("; ")}`]);
          continue;
        }

        const chunkUsage = Number(body[keys.usage] ?? 0);
        const chunkCost = Number(body[keys.cost] ?? 0);
        usage += chunkUsage;
        cost += chunkCost;
        const truncated = Array.isArray(body.truncated) && (body.truncated as string[]).includes(provider);
        if (truncated) truncatedChunks++;
        setBackfillLog((log) => [
          ...log,
          `${label}: ${chunkUsage} usage buckets, ${chunkCost} cost buckets${truncated ? " — truncated, see alert" : ""}`,
        ]);
        setBackfillProgress({ done: i + 1, total: chunks.length, current: null });
      }

      if (stopped) {
        setBackfillResult({ ok: false, message: stopped });
      } else {
        const parts = [`${usage} usage buckets`, `${cost} cost buckets`, `${chunks.length} chunk${chunks.length === 1 ? "" : "s"}`];
        if (failures > 0) parts.push(`${failures} failed`);
        if (truncatedChunks > 0) parts.push(`${truncatedChunks} truncated`);
        setBackfillResult({
          ok: failures === 0,
          message: `Backfill ${failures === 0 ? "complete" : "finished with errors"}: ${parts.join(", ")}.`,
        });
      }
      router.refresh();
    } catch (err) {
      setBackfillResult({
        ok: false,
        message: `Backfill failed: ${err instanceof Error ? err.message : "Network error"}`,
      });
    } finally {
      setBackfillRunning(false);
      setBackfillProgress(null);
    }
  }

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
          ...Object.fromEntries(
            Object.entries(providerOverrides).flatMap(([provider, override]) => [
              [`provider_sync_${provider}_enabled`, override.enabled || null],
              [`provider_sync_${provider}_interval_hours`, override.intervalHours || null],
            ])
          ),
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

  // Known keys from telemetry, plus any mapped key no longer seen (so a stale
  // mapping can still be cleared), grouped by provider.
  const keyMappingRows = (() => {
    const rows = knownApiKeys.map((key) => ({ ...key, stale: false }));
    const seen = new Set(rows.map((row) => `${row.provider}:${row.apiKeyExternalId}`));
    for (const [provider, keys] of Object.entries(keySystemMap)) {
      for (const apiKeyExternalId of Object.keys(keys)) {
        if (seen.has(`${provider}:${apiKeyExternalId}`)) continue;
        rows.push({ provider, apiKeyExternalId, apiKeyName: null, stale: true });
      }
    }
    return rows.sort((a, b) => a.provider.localeCompare(b.provider));
  })();

  function setKeyMapping(provider: string, apiKeyExternalId: string, aiSystemId: string) {
    setKeySystemMap((current) => {
      const next: ProviderKeySystemMap = { ...current, [provider]: { ...(current[provider] ?? {}) } };
      if (aiSystemId) {
        next[provider][apiKeyExternalId] = aiSystemId;
      } else {
        delete next[provider][apiKeyExternalId];
        if (Object.keys(next[provider]).length === 0) delete next[provider];
      }
      return next;
    });
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
          openai_managed_system_id: openaiManagedSystemId || null,
          litellm_managed_system_id: litellmManagedSystemId || null,
          provider_key_system_map: serializeProviderKeySystemMap(keySystemMap),
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
                Each provider runs on its own hourly cron and syncs when its own interval has elapsed since its last successful run. These are the defaults; override any provider below.
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


          <div className="space-y-2">
            <Label className="text-xs">Per-provider schedule</Label>
            <div className="overflow-x-auto rounded-md border border-[var(--border-subtle)]">
              <table className="w-full text-xs">
                <thead className="bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Provider</th>
                    <th className="px-3 py-2 text-left font-medium">Auto-sync</th>
                    <th className="px-3 py-2 text-left font-medium">Interval</th>
                    <th className="px-3 py-2 text-left font-medium">Last run</th>
                    <th className="px-3 py-2 text-left font-medium">Next due</th>
                  </tr>
                </thead>
                <tbody>
                  {providerSyncStatuses.map((status) => {
                    const override = providerOverrides[status.provider] ?? { enabled: "", intervalHours: "" };
                    const nextDue = !status.enabled
                      ? "Disabled"
                      : !status.configured
                        ? "Not configured"
                        : status.due
                          ? "Due on next tick"
                          : status.nextDueAt
                            ? formatDateTime(status.nextDueAt)
                            : "Due on next tick";
                    return (
                      <tr key={status.provider} className="border-t border-[var(--border-subtle)] align-top">
                        <td className="px-3 py-2">
                          <div className="font-medium text-[var(--text-primary)]">{status.label}</div>
                          <div className="text-[10px] text-[var(--text-faint)]">
                            <code>{status.provider}</code>
                            {" · "}
                            {status.configured ? "configured" : "not configured"}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            aria-label={`${status.label} auto-sync`}
                            value={override.enabled}
                            onChange={(e) =>
                              setProviderOverrides((prev) => ({
                                ...prev,
                                [status.provider]: { ...override, enabled: e.target.value },
                              }))
                            }
                            className="h-8 w-full min-w-[9rem] rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-xs text-[var(--text-primary)] appearance-none"
                          >
                            <option value="">Inherit ({providerSyncEnabled ? "Enabled" : "Disabled"})</option>
                            <option value="true">Enabled</option>
                            <option value="false">Disabled</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            aria-label={`${status.label} sync interval`}
                            value={override.intervalHours}
                            onChange={(e) =>
                              setProviderOverrides((prev) => ({
                                ...prev,
                                [status.provider]: { ...override, intervalHours: e.target.value },
                              }))
                            }
                            className="h-8 w-full min-w-[9rem] rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-xs text-[var(--text-primary)] appearance-none"
                          >
                            <option value="">Inherit (every {providerSyncIntervalHours} h)</option>
                            {INTERVAL_OPTIONS.map((hours) => (
                              <option key={hours} value={String(hours)}>
                                {hours === 1 ? "Every hour" : `Every ${hours} hours`}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          {status.lastRun ? (
                            <div className="space-y-1">
                              <Badge variant={runStatusVariant(status.lastRun.status)}>{status.lastRun.status}</Badge>
                              <div
                                className="text-[var(--text-muted)]"
                                title={status.lastRun.errorMessage ?? formatDateTime(status.lastRun.completedAt ?? status.lastRun.startedAt)}
                              >
                                {formatRelative(status.lastRun.completedAt ?? status.lastRun.startedAt, renderedAt)}
                                {status.lastRun.status === "SUCCEEDED" ? ` · ${status.lastRun.recordsProcessed} records` : ""}
                              </div>
                              {status.lastRun.errorMessage ? (
                                <div className="max-w-[16rem] truncate text-[var(--critical)]" title={status.lastRun.errorMessage}>
                                  {status.lastRun.errorMessage}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-[var(--text-faint)]">Never run</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[var(--text-muted)]" title={status.skippedReason}>
                          {nextDue}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-[var(--text-faint)]">
              Last run and next due reflect the page load. Each provider&apos;s cron fires hourly and only syncs once its own interval has passed since its last successful run.
            </p>
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
            <History className="h-4 w-4 text-[var(--accent)]" />
            <div>
              <h4 className="text-sm font-semibold">Sync History &amp; Backfill</h4>
              <p className="text-xs text-[var(--text-muted)]">
                Each scheduled sync resumes from the provider&apos;s watermark (re-pulling the last two days). Use Backfill to pull older history in {BACKFILL_CHUNK_DAYS}-day chunks, one request per chunk.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--text-muted)]">
                  <th className="py-1.5 pr-3 font-medium">Provider</th>
                  <th className="py-1.5 pr-3 font-medium">History from</th>
                  <th className="py-1.5 pr-3 font-medium">Watermark</th>
                  <th className="py-1.5 pr-3 font-medium">Max lookback</th>
                </tr>
              </thead>
              <tbody>
                {SYNC_PROVIDERS.map((provider) => {
                  const mark = watermarks.find((row) => row.provider === provider);
                  return (
                    <tr key={provider} className="border-t border-[var(--border-subtle)]">
                      <td className="py-1.5 pr-3 text-[var(--text-primary)]">
                        {SYNC_PROVIDER_LABELS[provider]}
                        {!providerConfigured[provider] && (
                          <span className="ml-1 text-[var(--text-faint)]">(not configured)</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-[var(--text-secondary)]">
                        {mark ? mark.earliest.slice(0, 10) : <span className="text-[var(--text-faint)]">no history yet</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-[var(--text-secondary)]">
                        {mark ? mark.watermark.slice(0, 10) : "—"}
                      </td>
                      <td className="py-1.5 pr-3 text-[var(--text-secondary)]">
                        {PROVIDER_MAX_LOOKBACK_DAYS[provider]} days
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label className="text-xs">Provider</Label>
              <select
                value={backfillProvider}
                onChange={(e) => setBackfillProvider(e.target.value as SyncProvider)}
                disabled={backfillRunning}
                className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
              >
                {SYNC_PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>
                    {SYNC_PROVIDER_LABELS[provider]}{providerConfigured[provider] ? "" : " (not configured)"}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">From (UTC day)</Label>
              <Input type="date" value={backfillFrom} max={backfillTo} disabled={backfillRunning} onChange={(e) => setBackfillFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">To (UTC day, inclusive)</Label>
              <Input type="date" value={backfillTo} min={backfillFrom} disabled={backfillRunning} onChange={(e) => setBackfillTo(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={handleBackfill}
              disabled={backfillRunning || !providerConfigured[backfillProvider] || !backfillFrom || !backfillTo}
            >
              {backfillRunning ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <History className="mr-1.5 h-3 w-3" />}
              {backfillRunning ? "Backfilling..." : "Backfill"}
            </Button>
            {backfillRunning && (
              <Button size="sm" variant="outline" onClick={() => { backfillCancelRef.current = true; }}>
                Cancel
              </Button>
            )}
            {backfillProgress && (
              <span className="text-xs text-[var(--text-muted)]">
                Chunk {Math.min(backfillProgress.done + 1, backfillProgress.total)} of {backfillProgress.total}
                {backfillProgress.current ? ` — ${backfillProgress.current}` : ""}
              </span>
            )}
            {backfillResult && !backfillRunning && (
              <span className={`text-xs ${backfillResult.ok ? "text-[var(--success)]" : "text-[var(--critical)]"}`}>
                {backfillResult.message}
              </span>
            )}
          </div>

          {backfillLog.length > 0 && (
            <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2 font-mono text-[11px] text-[var(--text-secondary)]">
              {backfillLog.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          )}
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
                Control when the hourly governance-automation cron creates renewal reminders and ownership escalation alerts.
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

          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["anthropic", anthropicManagedSystemId, setAnthropicManagedSystemId],
                ["openai", openaiManagedSystemId, setOpenaiManagedSystemId],
                ["litellm", litellmManagedSystemId, setLitellmManagedSystemId],
              ] as const
            ).map(([provider, value, setValue]) => (
              <div key={provider} className="space-y-2">
                <Label className="text-xs">{KEY_MAPPABLE_PROVIDER_LABELS[provider]} default system</Label>
                <select
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
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
            ))}
          </div>

          <div className="space-y-2">
            <div>
              <Label className="text-xs">Per-key overrides</Label>
              <p className="text-xs text-[var(--text-muted)]">
                Map an individual provider API key to a registered system. A key mapping wins over the provider
                default and applies to both usage and cost rows. Keys appear here once a provider sync has seen them
                (last 90 days).
              </p>
            </div>
            {keyMappingRows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--border-subtle)] p-3 text-xs text-[var(--text-muted)]">
                No provider API keys seen yet — run a provider sync first.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--bg-elevated)] text-left text-xs text-[var(--text-muted)]">
                    <tr>
                      <th className="px-3 py-2 font-medium">Provider</th>
                      <th className="px-3 py-2 font-medium">API key</th>
                      <th className="px-3 py-2 font-medium">Governed system</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keyMappingRows.map((row) => (
                      <tr key={`${row.provider}:${row.apiKeyExternalId}`} className="border-t border-[var(--border-subtle)]">
                        <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                          {KEY_MAPPABLE_PROVIDER_LABELS[row.provider as KeyMappableProvider] ?? row.provider}
                        </td>
                        <td className="px-3 py-2">
                          <p className="text-sm text-[var(--text-primary)]">{row.apiKeyName ?? row.apiKeyExternalId}</p>
                          <p className="font-mono text-[11px] text-[var(--text-muted)]">
                            {row.apiKeyExternalId}
                            {row.stale ? " · not seen recently" : ""}
                          </p>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={keySystemMap[row.provider]?.[row.apiKeyExternalId] ?? ""}
                            onChange={(e) => setKeyMapping(row.provider, row.apiKeyExternalId, e.target.value)}
                            className="flex h-8 w-full min-w-[12rem] rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text-primary)] appearance-none"
                          >
                            <option value="">— Provider default —</option>
                            {aiSystems.map((sys) => (
                              <option key={sys.id} value={sys.id}>
                                {sys.name}{sys.vendor ? ` (${sys.vendor})` : ""}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold">GitHub Copilot usage metrics</h4>
              <p className="text-xs text-[var(--text-muted)]">
                Per-user daily Copilot activity (interactions, accepted lines, features, IDEs, models) and organization totals from the Copilot usage metrics reports, plus seat assignments for identity. Feeds the Copilot dashboard and Usage by Person.
              </p>
            </div>
            {hasGitHubCopilotConfig ? (
              <Badge variant="success" className="gap-1"><Wifi className="h-3 w-3" /> Configured</Badge>
            ) : (
              <Badge variant="outline" className="gap-1"><WifiOff className="h-3 w-3" /> Not configured</Badge>
            )}
          </div>
          <GitHubCopilotSettings initial={githubCopilot} />
        </div>
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
