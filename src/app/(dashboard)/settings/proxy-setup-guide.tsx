"use client";

import { useState } from "react";
import {
  Eye,
  Copy,
  Check,
  ExternalLink,
  Terminal,
  Braces,
  Server,
  ShieldCheck,
  Loader2,
  Cloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HelpHint } from "@/components/help/help-hint";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Props {
  proxySecret: string;
  platformUrl: string;
  azureOpenAIEndpoint: string;
  azureOpenAIDeployments: string;
  /** Azure Functions app name (from the Proxy Health connection), if known. */
  functionAppName: string;
}

function CopyBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="relative group">
      {label && (
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1.5">
          {label}
        </p>
      )}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-deep)] overflow-hidden">
        <pre className="p-4 text-[12px] leading-relaxed font-mono text-[var(--text-secondary)] overflow-x-auto whitespace-pre">
          {code}
        </pre>
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 rounded-md p-1.5 text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors opacity-0 group-hover:opacity-100"
          title="Copy to clipboard"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-[var(--success)]" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

function HeaderRow({
  name,
  required,
  children,
}: {
  name: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[170px_60px_1fr] gap-2 items-start">
      <code className="text-[var(--accent)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded break-all">{name}</code>
      {required ? (
        <span className="text-[var(--critical)]">required</span>
      ) : (
        <span className="text-[var(--text-faint)]">optional</span>
      )}
      <span className="text-[var(--text-muted)]">{children}</span>
    </div>
  );
}

function Note({ children, tone = "warning" }: { children: React.ReactNode; tone?: "warning" | "info" }) {
  return tone === "warning" ? (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
      <p className="text-xs text-[var(--warning)]">{children}</p>
    </div>
  ) : (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
      <p className="text-xs text-[var(--text-muted)]">{children}</p>
    </div>
  );
}

const ATTRIBUTION_HEADERS_TS = (secret: string) => `  defaultHeaders: {
    "x-proxy-key": "${secret}",
    "x-department": "Engineering",
    "x-user-email": "developer@company.com",
    // Registered AI agents: add the id from the agent's MCP Tool Governance card
    // "x-agent-id": "<agent id>",
  },`;

export function ProxySetupGuide({
  proxySecret,
  platformUrl,
  azureOpenAIEndpoint,
  azureOpenAIDeployments,
  functionAppName,
}: Props) {
  const [customUrl, setCustomUrl] = useState(platformUrl);
  const [customSecret, setCustomSecret] = useState(proxySecret);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);

  const [azureEndpoint, setAzureEndpoint] = useState(azureOpenAIEndpoint);
  const [azureDeployments, setAzureDeployments] = useState(
    azureOpenAIDeployments || '{\n  "gpt4o-prod": "gpt-4o"\n}'
  );
  const [savingAzure, setSavingAzure] = useState(false);
  const [azureResult, setAzureResult] = useState<string | null>(null);

  const base = customUrl.replace(/\/+$/, "");
  const azureFunctionsBase = functionAppName ? `https://${functionAppName}.azurewebsites.net` : null;

  const claudeProxyUrl = `${base}/api/proxy/anthropic`;
  const openaiProxyUrl = `${base}/api/proxy/openai/v1`;
  const azureOpenAIProxyUrl = `${base}/api/proxy/azure-openai`;
  const geminiProxyUrl = `${base}/api/proxy/gemini`;
  const bedrockProxyUrl = `${base}/api/proxy/bedrock`;

  const providerUrls: Array<{ provider: string; vercel: string; azure: string | null; note: string }> = [
    { provider: "Claude", vercel: claudeProxyUrl, azure: azureFunctionsBase ? `${azureFunctionsBase}/api/proxy/anthropic` : null, note: "Anthropic SDK baseURL" },
    { provider: "OpenAI", vercel: openaiProxyUrl, azure: azureFunctionsBase ? `${azureFunctionsBase}/api/proxy/openai/v1` : null, note: "OpenAI SDK baseURL — chat, responses, embeddings, and all other /v1 paths" },
    { provider: "Azure OpenAI", vercel: azureOpenAIProxyUrl, azure: azureFunctionsBase ? `${azureFunctionsBase}/api/proxy/azure-openai` : null, note: "AzureOpenAI SDK endpoint — deployment path and api-version are forwarded" },
    { provider: "Gemini", vercel: geminiProxyUrl, azure: azureFunctionsBase ? `${azureFunctionsBase}/api/proxy/gemini` : null, note: "Google GenAI SDK baseUrl" },
    { provider: "Bedrock", vercel: bedrockProxyUrl, azure: azureFunctionsBase ? `${azureFunctionsBase}/api/proxy/bedrock` : null, note: "AWS SDK endpoint — client-signed, log only" },
  ];

  const claudeCodeManagedSettings = `{
  "env": {
    "ANTHROPIC_BASE_URL": "${claudeProxyUrl}",
    "ANTHROPIC_CUSTOM_HEADERS": "x-proxy-key: ${customSecret}\\nx-department: \${DEPARTMENT}\\nx-user-email: \${PROXY_USER_EMAIL}"
  }
}`;

  const claudeCodeUserSettings = `// ~/.claude/settings.json
{
  "env": {
    "ANTHROPIC_BASE_URL": "${claudeProxyUrl}",
    "ANTHROPIC_CUSTOM_HEADERS": "x-proxy-key: ${customSecret}\\nx-department: Engineering\\nx-user-email: \${PROXY_USER_EMAIL}"
  }
}`;

  const claudeSdkExample = `import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: "${claudeProxyUrl}",
${ATTRIBUTION_HEADERS_TS(customSecret)}
});

// Use normally — all calls are automatically logged
const message = await client.messages.create({
  model: "claude-sonnet-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
});`;

  const pythonClaudeExample = `import anthropic

client = anthropic.Anthropic(
    api_key=os.environ["ANTHROPIC_API_KEY"],
    base_url="${claudeProxyUrl}",
    default_headers={
        "x-proxy-key": "${customSecret}",
        "x-department": "Data Science",
        "x-user-email": "analyst@company.com",
        # Registered AI agents: "x-agent-id": "<agent id>",
    },
)

message = client.messages.create(
    model="claude-sonnet-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}],
)`;

  const claudeCurlExample = `curl ${claudeProxyUrl}/v1/messages \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: \$ANTHROPIC_API_KEY" \\
  -H "x-proxy-key: ${customSecret}" \\
  -H "x-department: Engineering" \\
  -H "x-user-email: \$PROXY_USER_EMAIL" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "claude-sonnet-5",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'`;

  const openaiSdkExample = `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "${openaiProxyUrl}",
${ATTRIBUTION_HEADERS_TS(customSecret)}
});

// Chat Completions, Responses and Embeddings are all logged with tokens + cost.
const completion = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});
const response = await client.responses.create({
  model: "gpt-5",
  input: "Summarize this ticket",
});
const embedding = await client.embeddings.create({
  model: "text-embedding-3-small",
  input: "search text",
});`;

  const pythonOpenaiExample = `from openai import OpenAI

client = OpenAI(
    api_key=os.environ["OPENAI_API_KEY"],
    base_url="${openaiProxyUrl}",
    default_headers={
        "x-proxy-key": "${customSecret}",
        "x-department": "Data Science",
        "x-user-email": "analyst@company.com",
    },
)

completion = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello"}],
)
response = client.responses.create(model="gpt-5", input="Summarize this ticket")`;

  const openaiCurlExample = `curl ${openaiProxyUrl}/responses \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer \$OPENAI_API_KEY" \\
  -H "x-proxy-key: ${customSecret}" \\
  -H "x-department: Marketing" \\
  -H "x-user-email: \$PROXY_USER_EMAIL" \\
  -d '{"model": "gpt-5", "input": "Hello"}'`;

  const azureSdkExample = `import { AzureOpenAI } from "openai";

const client = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  endpoint: "${azureOpenAIProxyUrl}",
  apiVersion: "2024-10-21",
  deployment: "gpt4o-prod",
${ATTRIBUTION_HEADERS_TS(customSecret)}
});

// The deployment path and api-version are forwarded to your resource;
// the deployment map above prices "gpt4o-prod" as gpt-4o.
const completion = await client.chat.completions.create({
  model: "gpt4o-prod",
  messages: [{ role: "user", content: "Hello" }],
});`;

  const azurePythonExample = `from openai import AzureOpenAI

client = AzureOpenAI(
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    azure_endpoint="${azureOpenAIProxyUrl}",
    api_version="2024-10-21",
    default_headers={
        "x-proxy-key": "${customSecret}",
        "x-department": "Data Science",
        "x-user-email": "analyst@company.com",
    },
)

completion = client.chat.completions.create(
    model="gpt4o-prod",  # deployment name
    messages=[{"role": "user", "content": "Hello"}],
)`;

  const azureCurlExample = `curl "${azureOpenAIProxyUrl}/openai/deployments/gpt4o-prod/chat/completions?api-version=2024-10-21" \\
  -H "Content-Type: application/json" \\
  -H "api-key: \$AZURE_OPENAI_API_KEY" \\
  -H "x-proxy-key: ${customSecret}" \\
  -H "x-user-email: \$PROXY_USER_EMAIL" \\
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'`;

  const geminiSdkExample = `import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    baseUrl: "${geminiProxyUrl}",
    headers: {
      "x-proxy-key": "${customSecret}",
      "x-department": "Engineering",
      "x-user-email": "developer@company.com",
    },
  },
});

// generateContent and streamGenerateContent are logged with tokens + cost.
const result = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: "Hello",
});`;

  const geminiPythonExample = `from google import genai
from google.genai import types

client = genai.Client(
    api_key=os.environ["GEMINI_API_KEY"],
    http_options=types.HttpOptions(
        base_url="${geminiProxyUrl}",
        headers={
            "x-proxy-key": "${customSecret}",
            "x-department": "Data Science",
            "x-user-email": "analyst@company.com",
        },
    ),
)

result = client.models.generate_content(model="gemini-2.5-flash", contents="Hello")`;

  const geminiCurlExample = `curl "${geminiProxyUrl}/v1beta/models/gemini-2.5-flash:generateContent" \\
  -H "Content-Type: application/json" \\
  -H "x-goog-api-key: \$GEMINI_API_KEY" \\
  -H "x-proxy-key: ${customSecret}" \\
  -H "x-user-email: \$PROXY_USER_EMAIL" \\
  -d '{"contents": [{"parts": [{"text": "Hello"}]}]}'`;

  const bedrockSdkExample = `import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

// Recommended: a Bedrock API key (Bearer token). No request signing, so the
// proxy can forward the request verbatim and still log it.
process.env.AWS_BEARER_TOKEN_BEDROCK = process.env.BEDROCK_API_KEY;

const client = new BedrockRuntimeClient({
  region: "us-east-1",
  endpoint: "${bedrockProxyUrl}",
});

// Attribution headers are added after auth so they never enter a signature.
client.middlewareStack.add(
  (next) => async (args) => {
    const request = args.request as { headers: Record<string, string> };
    request.headers["x-proxy-key"] = "${customSecret}";
    request.headers["x-aws-region"] = "us-east-1";
    request.headers["x-department"] = "Engineering";
    request.headers["x-user-email"] = "developer@company.com";
    return next(args);
  },
  { step: "finalizeRequest", priority: "low", name: "urnammuAttribution" }
);

const response = await client.send(
  new InvokeModelCommand({
    modelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
    contentType: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 256,
      messages: [{ role: "user", content: "Hello" }],
    }),
  })
);`;

  const bedrockCurlExample = `curl "${bedrockProxyUrl}/model/anthropic.claude-sonnet-4-5-20250929-v1:0/invoke" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer \$AWS_BEARER_TOKEN_BEDROCK" \\
  -H "x-aws-region: us-east-1" \\
  -H "x-proxy-key: ${customSecret}" \\
  -H "x-user-email: \$PROXY_USER_EMAIL" \\
  -d '{
    "anthropic_version": "bedrock-2023-05-31",
    "max_tokens": 256,
    "messages": [{"role": "user", "content": "Hello"}]
  }'`;

  async function saveProxySettings() {
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proxy_secret: customSecret,
          platform_url: customUrl,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? "Failed to save proxy settings");
      setSaveResult("Proxy settings saved.");
    } catch (error) {
      setSaveResult(error instanceof Error ? error.message : "Failed to save proxy settings");
    } finally {
      setSaving(false);
    }
  }

  async function saveAzureSettings() {
    setSavingAzure(true);
    setAzureResult(null);
    try {
      const trimmedDeployments = azureDeployments.trim();
      if (trimmedDeployments) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmedDeployments);
        } catch {
          throw new Error("Deployment map must be valid JSON.");
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error('Deployment map must be a JSON object like {"deployment": "model"}.');
        }
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value !== "string" || !value.trim()) {
            throw new Error(`Deployment "${key}" must map to a model id string.`);
          }
        }
      }
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          azure_openai_endpoint: azureEndpoint.trim() || null,
          azure_openai_deployments: trimmedDeployments || null,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? "Failed to save Azure OpenAI settings");
      setAzureResult("Azure OpenAI settings saved. The Azure Functions proxy picks them up within a minute.");
    } catch (error) {
      setAzureResult(error instanceof Error ? error.message : "Failed to save Azure OpenAI settings");
    } finally {
      setSavingAzure(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-[var(--accent)]" />
            AI API Proxy &mdash; Usage Monitoring
          </CardTitle>
          <CardDescription>
            Route Claude, OpenAI, Azure OpenAI, Gemini and Amazon Bedrock API calls through the governance proxy to automatically log usage, track costs, and enforce policies across your organization.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* How it works */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
              <Server className="h-4 w-4 text-[var(--accent)] shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-[var(--text-primary)]">Transparent Proxy</p>
                <p className="text-[11px] text-[var(--text-faint)] mt-0.5">Apps send requests to your proxy URL instead of the AI provider directly.</p>
              </div>
            </div>
            <div className="flex gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
              <Eye className="h-4 w-4 text-[var(--accent)] shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-[var(--text-primary)]">Auto Logging</p>
                <p className="text-[11px] text-[var(--text-faint)] mt-0.5">Every request is logged with model, tokens, cost, department, and user.</p>
              </div>
            </div>
            <div className="flex gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
              <ShieldCheck className="h-4 w-4 text-[var(--accent)] shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-[var(--text-primary)]">Uniform Governance</p>
                <p className="text-[11px] text-[var(--text-faint)] mt-0.5">Policy-as-code, MCP tool allowlists and prompt-risk detection apply to every provider.</p>
              </div>
            </div>
          </div>

          {/* Proxy URLs */}
          <div className="space-y-3 pt-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-[11px]">Platform URL</Label>
                <Input
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder="https://urnammu.yourcompany.com"
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px]">Proxy Secret (PROXY_SECRET)</Label>
                <Input
                  value={customSecret}
                  onChange={(e) => setCustomSecret(e.target.value)}
                  placeholder="your-proxy-secret"
                  className="font-mono text-xs"
                />
              </div>
            </div>
            <p className="text-[10px] text-[var(--text-faint)]">
              Edit these values to generate correct code snippets below. Saving here updates the app-level proxy configuration used by ingestion and usage-monitoring routes.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <Button onClick={saveProxySettings} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {saving ? "Saving..." : "Save Proxy Settings"}
              </Button>
              {saveResult && (
                <span className="text-sm text-[var(--text-muted)]">{saveResult}</span>
              )}
            </div>
          </div>

          {/* Per-provider base URLs */}
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-3">
              Proxy base URL per provider
            </p>
            <div className="space-y-2 text-xs">
              {providerUrls.map((row) => (
                <div key={row.provider} className="grid grid-cols-[110px_1fr] gap-2 items-start">
                  <span className="font-medium text-[var(--text-primary)]">{row.provider}</span>
                  <div className="min-w-0 space-y-0.5">
                    <code className="block break-all text-[var(--accent)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded">{row.vercel}</code>
                    {row.azure && (
                      <code className="block break-all text-[var(--text-secondary)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded">{row.azure}</code>
                    )}
                    <p className="text-[10px] text-[var(--text-faint)]">{row.note}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-[var(--text-faint)] mt-3">
              {azureFunctionsBase
                ? "The first URL is the Vercel fallback proxy; the second is the Azure Functions proxy (recommended for long streams). Both write to the same database."
                : "These are the Vercel fallback proxy URLs. When the Azure Functions proxy is deployed, use https://<function-app>.azurewebsites.net/api/proxy/<provider> instead (recommended for long streams); set the function app name under Settings → General → Azure Monitor to show it here."}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Azure OpenAI passthrough config */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-[var(--accent)]" />
            Azure OpenAI &mdash; Resource &amp; Deployment Map
            <HelpHint hint="proxy_azure_deployments" />
          </CardTitle>
          <CardDescription>
            Azure OpenAI requests name a deployment, not a model. Configure the resource endpoint the proxy forwards to and map each deployment to its model id so usage prices correctly. Clients may override the resource per request with <code className="bg-[var(--bg-elevated)] px-1 py-0.5 rounded text-[var(--accent)]">x-azure-openai-resource</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[11px]">Resource endpoint (or resource name)</Label>
              <Input
                value={azureEndpoint}
                onChange={(e) => setAzureEndpoint(e.target.value)}
                placeholder="https://my-resource.openai.azure.com"
                className="font-mono text-xs"
              />
              <p className="text-[10px] text-[var(--text-faint)]">
                Accepts <code>*.openai.azure.com</code>, <code>*.cognitiveservices.azure.com</code> and <code>*.services.ai.azure.com</code> hosts. Env fallback: <code>AZURE_OPENAI_ENDPOINT</code>.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px]">Deployment → model map (JSON)</Label>
              <textarea
                value={azureDeployments}
                onChange={(e) => setAzureDeployments(e.target.value)}
                rows={5}
                spellCheck={false}
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-deep)] p-2 font-mono text-xs text-[var(--text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
              <p className="text-[10px] text-[var(--text-faint)]">
                Unmapped deployments price by their name (works when deployments are named after models). Env fallback: <code>AZURE_OPENAI_DEPLOYMENTS</code>.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={saveAzureSettings} disabled={savingAzure}>
              {savingAzure ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {savingAzure ? "Saving..." : "Save Azure OpenAI Settings"}
            </Button>
            {azureResult && <span className="text-sm text-[var(--text-muted)]">{azureResult}</span>}
          </div>
        </CardContent>
      </Card>

      {/* Claude Code — Org-Wide Setup */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-[var(--accent)]" />
            Claude Code &mdash; Organization-Wide Setup
          </CardTitle>
          <CardDescription>
            Force all Claude Code sessions across your org to route through the proxy. Managed settings have the highest priority and cannot be overridden by users.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Tabs defaultValue="managed">
            <TabsList>
              <TabsTrigger value="managed">Managed (Recommended)</TabsTrigger>
              <TabsTrigger value="user">Per-User</TabsTrigger>
            </TabsList>

            <TabsContent value="managed" className="space-y-4 mt-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-dim)] text-[10px] font-bold text-[var(--accent)]">1</span>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Open Claude.ai Admin Console</p>
                </div>
                <p className="text-xs text-[var(--text-muted)] ml-7">
                  Go to{" "}
                  <a href="https://claude.ai" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline inline-flex items-center gap-0.5">
                    claude.ai <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                  {" "}&rarr; Admin Settings &rarr; Claude Code &rarr; Managed Settings
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-dim)] text-[10px] font-bold text-[var(--accent)]">2</span>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Paste this JSON into managed settings</p>
                </div>
                <div className="ml-7">
                  <CopyBlock code={claudeCodeManagedSettings} />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-dim)] text-[10px] font-bold text-[var(--accent)]">3</span>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Save</p>
                </div>
                <p className="text-xs text-[var(--text-muted)] ml-7">
                  All Claude Code sessions will now route through your proxy. This setting has the highest priority &mdash; users cannot override it.
                </p>
              </div>
              <div className="ml-7">
                <Note>
                  <strong>Requires Claude for Teams or Enterprise.</strong> Free and Pro plans do not have access to managed settings. Use the per-user method instead.
                </Note>
              </div>
            </TabsContent>

            <TabsContent value="user" className="space-y-4 mt-4">
              <p className="text-xs text-[var(--text-muted)]">
                Each developer adds this to their <code className="bg-[var(--bg-elevated)] px-1 py-0.5 rounded text-[var(--accent)]">~/.claude/settings.json</code>:
              </p>
              <CopyBlock code={claudeCodeUserSettings} />
              <p className="text-[10px] text-[var(--text-faint)]">
                This can be distributed via your dotfiles repo, onboarding script, or MDM profile.
              </p>
            </TabsContent>
          </Tabs>

          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)] flex items-center gap-1">
              User Attribution Setup
              <HelpHint hint="proxy_attribution" />
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              Both methods above reference <code className="bg-[var(--bg-elevated)] px-1 py-0.5 rounded text-[var(--accent)]">PROXY_USER_EMAIL</code> to attribute usage to individual users.
              Each developer needs to add one line to their shell profile (<code className="bg-[var(--bg-elevated)] px-1 py-0.5 rounded text-[var(--accent)]">~/.zshrc</code> or <code className="bg-[var(--bg-elevated)] px-1 py-0.5 rounded text-[var(--accent)]">~/.bashrc</code>):
            </p>
            <CopyBlock code={'export PROXY_USER_EMAIL="$(git config user.email)"'} label="Add to shell profile" />
            <p className="text-[10px] text-[var(--text-muted)]">
              This reads the email from the developer&apos;s existing git config, so there&apos;s nothing extra to maintain. After adding, run <code className="bg-[var(--bg-elevated)] px-1 py-0.5 rounded text-[var(--accent)]">source ~/.zshrc</code> or open a new terminal. Distribute this via your onboarding script or dotfiles repo.
            </p>
            <p className="text-[10px] text-[var(--text-faint)]">
              Without this variable set, usage will still be logged but will appear as &ldquo;Unattributed&rdquo; on the Oversight dashboards.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* SDK Integration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Braces className="h-4 w-4 text-[var(--accent)]" />
            SDK Integration &mdash; per provider
          </CardTitle>
          <CardDescription>
            For applications using a provider SDK directly, change the base URL (or endpoint) to route through the proxy and add the attribution headers. All SDK features keep working.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Tabs defaultValue="claude">
            <TabsList className="flex-wrap">
              <TabsTrigger value="claude">Claude</TabsTrigger>
              <TabsTrigger value="openai">OpenAI</TabsTrigger>
              <TabsTrigger value="azure">Azure OpenAI</TabsTrigger>
              <TabsTrigger value="gemini">Gemini</TabsTrigger>
              <TabsTrigger value="bedrock">Bedrock</TabsTrigger>
            </TabsList>

            <TabsContent value="claude" className="mt-4 space-y-4">
              <CopyBlock code={claudeSdkExample} label="Anthropic TypeScript SDK" />
              <CopyBlock code={pythonClaudeExample} label="Anthropic Python SDK" />
              <CopyBlock code={claudeCurlExample} label="cURL" />
              <Note tone="info">
                <code>/v1/messages</code> is logged with tokens and cost. <code>/v1/messages/count_tokens</code> and <code>/v1/messages/batches</code> pass through untouched.
              </Note>
            </TabsContent>

            <TabsContent value="openai" className="mt-4 space-y-4">
              <CopyBlock code={openaiSdkExample} label="OpenAI TypeScript SDK" />
              <CopyBlock code={pythonOpenaiExample} label="OpenAI Python SDK" />
              <CopyBlock code={openaiCurlExample} label="cURL (Responses API)" />
              <Note tone="info">
                Every <code>/v1/*</code> path is forwarded. Chat Completions, Completions, Responses and Embeddings are logged with tokens and cost; images, audio, files, batches and other endpoints are logged as 0-token rows with the endpoint in metadata. Streaming Chat Completions get <code>stream_options.include_usage</code> injected transparently.
              </Note>
            </TabsContent>

            <TabsContent value="azure" className="mt-4 space-y-4">
              <CopyBlock code={azureSdkExample} label="OpenAI TypeScript SDK (AzureOpenAI)" />
              <CopyBlock code={azurePythonExample} label="OpenAI Python SDK (AzureOpenAI)" />
              <CopyBlock code={azureCurlExample} label="cURL" />
              <Note tone="info">
                Configure the resource endpoint and deployment map in the card above. The proxy forwards <code>/openai/deployments/&lt;deployment&gt;/…?api-version=…</code> (and the newer <code>/openai/v1/…</code> paths) with your <code>api-key</code> or Entra bearer token. Usage is priced at OpenAI list rates for the mapped model.
              </Note>
            </TabsContent>

            <TabsContent value="gemini" className="mt-4 space-y-4">
              <CopyBlock code={geminiSdkExample} label="Google GenAI TypeScript SDK" />
              <CopyBlock code={geminiPythonExample} label="Google GenAI Python SDK" />
              <CopyBlock code={geminiCurlExample} label="cURL" />
              <Note tone="info">
                <code>:generateContent</code> and <code>:streamGenerateContent</code> (SSE with <code>?alt=sse</code>, or the JSON-array stream) are logged from <code>usageMetadata</code>, including cached and thinking tokens. <code>countTokens</code>, <code>embedContent</code> and file operations pass through as 0-token rows.
              </Note>
            </TabsContent>

            <TabsContent value="bedrock" className="mt-4 space-y-4">
              <CopyBlock code={bedrockSdkExample} label="AWS SDK for JavaScript v3 (Bedrock API key)" />
              <CopyBlock code={bedrockCurlExample} label="cURL (Bedrock API key)" />
              <Note>
                <strong>Log only (v1).</strong> The proxy forwards Bedrock calls with the client&apos;s own AWS credentials and never injects keys.
                Bedrock API keys (<code>Authorization: Bearer</code>) work as shown. SigV4-signed requests are forwarded byte-for-byte with every signed header, so the signature must be computed for <code>bedrock-runtime.&lt;region&gt;.amazonaws.com</code> (not the proxy host) and the <code>x-proxy-key</code> / attribution headers must be added <em>after</em> signing so they stay unsigned. Signing with a proxy-held IAM role is a separate decision.
                <HelpHint hint="proxy_bedrock_auth" />
              </Note>
              <Note tone="info">
                <code>/model/&lt;modelId&gt;/invoke</code> and <code>/invoke-with-response-stream</code> (Anthropic Messages API) are logged with tokens and cost; model ids such as <code>us.anthropic.claude-sonnet-4-5-…-v1:0</code> are normalised to the Anthropic id for pricing. Send <code>x-aws-region</code> when using an API key; signed requests carry the region in their credential scope.
              </Note>
            </TabsContent>
          </Tabs>

          {/* Headers reference */}
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-3 flex items-center gap-1">
              Request Headers Reference
              <HelpHint hint="proxy_attribution" />
            </p>
            <div className="space-y-2 text-xs">
              <HeaderRow name="x-proxy-key" required>Must match PROXY_SECRET on the server</HeaderRow>
              <HeaderRow name="x-api-key">Anthropic API key (falls back to server default)</HeaderRow>
              <HeaderRow name="Authorization">OpenAI <code>Bearer</code> key; Azure Entra token; Bedrock API key (<code>Bearer</code>) or SigV4 signature</HeaderRow>
              <HeaderRow name="api-key">Azure OpenAI resource key (forwarded verbatim)</HeaderRow>
              <HeaderRow name="x-azure-openai-resource">Azure OpenAI resource name or endpoint, overriding the configured one</HeaderRow>
              <HeaderRow name="x-goog-api-key">Gemini API key (forwarded verbatim; <code>?key=</code> also works)</HeaderRow>
              <HeaderRow name="x-aws-region">Bedrock region (e.g. <code>us-east-1</code>); inferred from a SigV4 signature when absent</HeaderRow>
              <HeaderRow name="x-department">Department name for cost attribution</HeaderRow>
              <HeaderRow name="x-user-email">User email to link usage to a platform user</HeaderRow>
              <HeaderRow name="x-ai-system-id">Links usage to a registered AI system and enables its policy-as-code rules</HeaderRow>
              <HeaderRow name="x-agent-id">Links usage to a registered AI agent and applies its governance: MCP allowlists, human-review triggers, the kill switch and behaviour baseline. Clients must handle 403 <code>agent_blocked</code>, <code>policy_denied</code> and <code>human_review_required</code>.</HeaderRow>
            </div>
          </div>

          {/* What gets logged */}
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-3">
              What Gets Logged
            </p>
            <div className="grid gap-2 sm:grid-cols-2 text-xs text-[var(--text-muted)]">
              <div className="flex items-center gap-2">
                <Check className="h-3 w-3 text-[var(--success)]" />
                Provider, model, endpoint and API version
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-3 w-3 text-[var(--success)]" />
                Input, cached and output token counts
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-3 w-3 text-[var(--success)]" />
                Estimated cost (built-in pricing tables)
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-3 w-3 text-[var(--success)]" />
                Department, user, system and agent attribution
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-3 w-3 text-[var(--success)]" />
                Response latency and upstream status
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-3 w-3 text-[var(--success)]" />
                Policy denials, MCP tool calls, prompt-risk and response-DLP flags
              </div>
            </div>
            <p className="text-[10px] text-[var(--text-faint)] mt-3">
              Prompt and response content is <strong>never</strong> stored. Only metadata and redacted excerpts of flagged matches are logged.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
