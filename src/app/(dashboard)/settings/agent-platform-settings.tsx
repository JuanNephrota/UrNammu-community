"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Calendar,
  Check,
  CircleAlert,
  Clock,
  Globe,
  KeyRound,
  Loader2,
  Play,
  ShieldCheck,
  Wifi,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface LastScan {
  status: string;
  startedAt: string;
  completedAt: string | null;
  found: number;
  created: number;
  updated: number;
  errorMessage: string | null;
}

interface Props {
  scanEnabled: boolean;
  scanIntervalHours: number;
  hasAnthropicKey: boolean;
  microsoftCopilotEnabled: boolean;
  microsoftConfigured: boolean;
  salesforceInstanceUrl: string;
  salesforceClientId: string;
  hasSalesforceClientSecret: boolean;
  hasOpenAIAdminKey: boolean;
  hasChatGPTEnterpriseConfig: boolean;
  lastScan: LastScan | null;
}

type Result = { success: boolean; message: string } | null;

const selectClass =
  "flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none";

async function putSettings(updates: Record<string, string | null>): Promise<string | null> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (res.ok) return null;
  const text = await res.text();
  try {
    return JSON.parse(text).error ?? `HTTP ${res.status}`;
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

async function postTest(path: string): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(path, { method: "POST" });
    const data = await res.json();
    if (!res.ok) return { success: false, message: data.error ?? `HTTP ${res.status}` };
    return { success: !!data.success, message: data.success ? data.message : data.error };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Network error" };
  }
}

function ResultLine({ result }: { result: Result }) {
  if (!result) return null;
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
        result.success
          ? "border-[var(--success)] text-[var(--success)]"
          : "border-[var(--critical)] text-[var(--critical)]"
      }`}
    >
      {result.success ? (
        <Check className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <X className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <p>{result.message}</p>
    </div>
  );
}

function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-muted)]">
      {ok ? (
        <ShieldCheck className="h-3.5 w-3.5 text-[var(--success)]" />
      ) : (
        <CircleAlert className="h-3.5 w-3.5 text-[var(--warning)]" />
      )}
      <span>{label}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">{title}</p>
      {children}
    </div>
  );
}

export function AgentPlatformSettings(props: Props) {
  const router = useRouter();
  const [scanEnabled, setScanEnabled] = useState(props.scanEnabled);
  const [scanIntervalHours, setScanIntervalHours] = useState(props.scanIntervalHours);
  const [anthropicKey, setAnthropicKey] = useState("");
  const [copilotEnabled, setCopilotEnabled] = useState(props.microsoftCopilotEnabled);
  const [sfInstanceUrl, setSfInstanceUrl] = useState(props.salesforceInstanceUrl);
  const [sfClientId, setSfClientId] = useState(props.salesforceClientId);
  const [sfClientSecret, setSfClientSecret] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<Result>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [anthropicResult, setAnthropicResult] = useState<Result>(null);
  const [copilotResult, setCopilotResult] = useState<Result>(null);
  const [salesforceResult, setSalesforceResult] = useState<Result>(null);
  const [importResult, setImportResult] = useState<Result>(null);

  const hasAnthropic = props.hasAnthropicKey || !!anthropicKey.trim();
  const hasSalesforce =
    !!sfInstanceUrl.trim() && !!sfClientId.trim() && (props.hasSalesforceClientSecret || !!sfClientSecret.trim());
  const copilotReady = copilotEnabled && props.microsoftConfigured;
  const anyConfigured = hasAnthropic || hasSalesforce || copilotReady;

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);
    const updates: Record<string, string | null> = {
      agent_platforms_scan_enabled: scanEnabled ? "true" : "false",
      agent_platforms_scan_interval_hours: String(scanIntervalHours),
      microsoft_copilot_agents_enabled: copilotEnabled ? "true" : "false",
      salesforce_instance_url: sfInstanceUrl.trim() || null,
      salesforce_client_id: sfClientId.trim() || null,
    };
    if (anthropicKey.trim()) updates.anthropic_managed_agents_api_key = anthropicKey.trim();
    if (sfClientSecret.trim()) updates.salesforce_client_secret = sfClientSecret.trim();
    try {
      const error = await putSettings(updates);
      if (error) {
        setSaveResult({ success: false, message: `Failed: ${error}` });
      } else {
        setSaveResult({ success: true, message: "Agent platform settings saved." });
        setAnthropicKey("");
        setSfClientSecret("");
        router.refresh();
      }
    } catch (err) {
      setSaveResult({ success: false, message: err instanceof Error ? err.message : "Network error" });
    } finally {
      setSaving(false);
    }
  }

  async function clearSecret(key: string, label: string) {
    if (!confirm(`Remove the stored ${label}?`)) return;
    setSaving(true);
    await putSettings({ [key]: null });
    setSaving(false);
    router.refresh();
  }

  async function runTest(name: string, path: string, set: (r: Result) => void) {
    setBusy(name);
    set(null);
    set(await postTest(path));
    setBusy(null);
  }

  async function runImport() {
    setBusy("import");
    setImportResult(null);
    try {
      const res = await fetch("/api/discovered-agents/import", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setImportResult({ success: false, message: data.error ?? `HTTP ${res.status}` });
      } else {
        setImportResult({
          success: data.status === "completed",
          message:
            `Found ${data.toolsFound} agent(s): ${data.newToolsAdded} new, ${data.updatedTools} updated.` +
            (data.errorMessage ? ` Errors: ${data.errorMessage}` : ""),
        });
        router.refresh();
      }
    } catch (err) {
      setImportResult({ success: false, message: err instanceof Error ? err.message : "Network error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-[var(--accent)]" />
          Agent Platforms
        </CardTitle>
        <CardDescription>
          Import the agents people have built on Anthropic Managed Agents, Microsoft 365 Copilot / Copilot
          Studio and Salesforce Agentforce into the review queue under Agents → Discovered. Each platform is
          skipped until it is configured.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-2 sm:grid-cols-5">
          <StatusChip ok={hasAnthropic} label="Anthropic" />
          <StatusChip ok={copilotReady} label="Microsoft Copilot" />
          <StatusChip ok={hasSalesforce} label="Salesforce" />
          <StatusChip ok={props.hasOpenAIAdminKey} label="OpenAI (with sync)" />
          <StatusChip ok={props.hasChatGPTEnterpriseConfig} label="ChatGPT GPTs (with sync)" />
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 text-sm text-[var(--text-muted)]">
          {props.lastScan ? (
            <p>
              Last import {props.lastScan.status} at{" "}
              {new Date(props.lastScan.completedAt ?? props.lastScan.startedAt).toLocaleString("en-US")}:{" "}
              {props.lastScan.found} agent(s) found, {props.lastScan.created} new, {props.lastScan.updated} updated.
              {props.lastScan.errorMessage ? (
                <span className="block text-[var(--warning)]">{props.lastScan.errorMessage}</span>
              ) : null}
            </p>
          ) : (
            <p>No agent platform import has run yet.</p>
          )}
          <p className="mt-2 text-xs text-[var(--text-faint)]">
            OpenAI Assistants are imported after each OpenAI sync and ChatGPT Enterprise custom GPTs after each
            ChatGPT Enterprise compliance sync (Settings → Provider Admin APIs); they need no settings here.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5" />
              Auto-import
            </Label>
            <select
              value={scanEnabled ? "true" : "false"}
              onChange={(e) => setScanEnabled(e.target.value === "true")}
              className={selectClass}
            >
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" />
              Import Interval
            </Label>
            <select
              value={String(scanIntervalHours)}
              onChange={(e) => setScanIntervalHours(parseInt(e.target.value, 10))}
              className={selectClass}
            >
              <option value="6">Every 6 hours</option>
              <option value="12">Every 12 hours</option>
              <option value="24">Every 24 hours</option>
              <option value="48">Every 48 hours</option>
            </select>
          </div>
        </div>

        <Section title="Anthropic Managed Agents">
          <p className="text-sm text-[var(--text-muted)]">
            Lists the saved agents in one Claude Platform workspace (<code className="font-mono">GET /v1/agents</code>
            ). Needs a regular API key from that workspace; the Admin API key is rejected by this endpoint. Only
            names, descriptions, models, tool types and MCP server names are read, never system prompts.
          </p>
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5" />
              Workspace API Key
            </Label>
            {props.hasAnthropicKey ? (
              <div className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] px-4 py-3">
                <Check className="h-4 w-4 text-[var(--success)]" />
                <span className="flex-1 text-sm text-[var(--text-muted)]">Managed Agents API key is configured</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => clearSecret("anthropic_managed_agents_api_key", "Managed Agents API key")}
                >
                  <X className="mr-1 h-3 w-3" /> Remove
                </Button>
              </div>
            ) : null}
            <Input
              type="password"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder={props.hasAnthropicKey ? "Paste a new key to replace the stored one" : "sk-ant-api03-…"}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null || !props.hasAnthropicKey}
            onClick={() => runTest("anthropic", "/api/settings/test-anthropic-managed-agents", setAnthropicResult)}
          >
            {busy === "anthropic" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wifi className="mr-2 h-4 w-4" />}
            Test Connection
          </Button>
          <ResultLine result={anthropicResult} />
        </Section>

        <Section title="Microsoft 365 Copilot / Copilot Studio">
          <p className="text-sm text-[var(--text-muted)]">
            Reads the tenant&apos;s Copilot agent catalog through the Microsoft 365 app registration above. Add the{" "}
            <code className="font-mono text-[var(--accent)]">CopilotPackages.Read.All</code> Microsoft Graph{" "}
            <em>application</em> permission and grant admin consent; the tenant also needs a Microsoft Agent 365
            license. Microsoft-built agents are skipped.
          </p>
          {!props.microsoftConfigured ? (
            <p className="text-xs text-[var(--warning)]">
              Configure the Microsoft 365 tenant ID, client ID and secret first.
            </p>
          ) : null}
          <div className="space-y-2">
            <Label>Import Copilot agents</Label>
            <select
              value={copilotEnabled ? "true" : "false"}
              onChange={(e) => setCopilotEnabled(e.target.value === "true")}
              className={selectClass}
            >
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </select>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null || !props.microsoftConfigured}
            onClick={() => runTest("copilot", "/api/settings/test-microsoft-copilot-agents", setCopilotResult)}
          >
            {busy === "copilot" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wifi className="mr-2 h-4 w-4" />}
            Test Permission
          </Button>
          <ResultLine result={copilotResult} />
        </Section>

        <Section title="Salesforce Agentforce">
          <ol className="space-y-1 text-sm text-[var(--text-muted)]">
            <li>1. Create a connected app (or external client app) with OAuth enabled and the api scope.</li>
            <li>2. Enable the Client Credentials Flow and set a Run As user (ideally an integration-only user).</li>
            <li>3. Paste the org&apos;s My Domain URL, the consumer key and the consumer secret below.</li>
          </ol>
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Globe className="h-3.5 w-3.5" />
              My Domain URL
            </Label>
            <Input
              value={sfInstanceUrl}
              onChange={(e) => setSfInstanceUrl(e.target.value)}
              placeholder="https://yourcompany.my.salesforce.com"
            />
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5" />
              Consumer Key (Client ID)
            </Label>
            <Input value={sfClientId} onChange={(e) => setSfClientId(e.target.value)} placeholder="3MVG9…" />
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5" />
              Consumer Secret
            </Label>
            {props.hasSalesforceClientSecret ? (
              <div className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] px-4 py-3">
                <Check className="h-4 w-4 text-[var(--success)]" />
                <span className="flex-1 text-sm text-[var(--text-muted)]">Salesforce consumer secret is configured</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => clearSecret("salesforce_client_secret", "Salesforce consumer secret")}
                >
                  <X className="mr-1 h-3 w-3" /> Remove
                </Button>
              </div>
            ) : null}
            <Input
              type="password"
              value={sfClientSecret}
              onChange={(e) => setSfClientSecret(e.target.value)}
              placeholder={
                props.hasSalesforceClientSecret ? "Paste a new secret to replace the stored one" : "Consumer secret"
              }
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null || !props.salesforceInstanceUrl || !props.salesforceClientId || !props.hasSalesforceClientSecret}
            onClick={() => runTest("salesforce", "/api/settings/test-salesforce", setSalesforceResult)}
          >
            {busy === "salesforce" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wifi className="mr-2 h-4 w-4" />}
            Test Connection
          </Button>
          <ResultLine result={salesforceResult} />
        </Section>

        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border-subtle)] pt-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {saving ? "Saving..." : "Save Agent Platform Settings"}
          </Button>
          <Button variant="outline" onClick={runImport} disabled={busy !== null || !anyConfigured}>
            {busy === "import" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Import Now
          </Button>
        </div>
        <p className="text-[10px] text-[var(--text-faint)]">
          Test and Import use the saved settings — save first. Secrets are stored encrypted and never shown again.
        </p>
        <ResultLine result={saveResult} />
        <ResultLine result={importResult} />
      </CardContent>
    </Card>
  );
}
