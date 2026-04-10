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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Props {
  proxySecret: string;
  platformUrl: string;
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

export function ProxySetupGuide({ proxySecret, platformUrl }: Props) {
  const [customUrl, setCustomUrl] = useState(platformUrl);
  const [customSecret, setCustomSecret] = useState(proxySecret);

  const claudeProxyUrl = `${customUrl}/api/proxy/anthropic`;
  const openaiProxyUrl = `${customUrl}/api/proxy/openai`;

  const claudeCodeManagedSettings = `{
  "env": {
    "ANTHROPIC_BASE_URL": "${claudeProxyUrl}",
    "ANTHROPIC_CUSTOM_HEADERS": "x-proxy-key: ${customSecret}\\nx-department: \${DEPARTMENT}"
  }
}`;

  const claudeCodeUserSettings = `// ~/.claude/settings.json
{
  "env": {
    "ANTHROPIC_BASE_URL": "${claudeProxyUrl}",
    "ANTHROPIC_CUSTOM_HEADERS": "x-proxy-key: ${customSecret}\\nx-department: Engineering"
  }
}`;

  const claudeSdkExample = `import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: "${claudeProxyUrl}",
  defaultHeaders: {
    "x-proxy-key": "${customSecret}",
    "x-department": "Engineering",
    "x-user-email": "developer@company.com",
  },
});

// Use normally — all calls are automatically logged
const message = await client.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
});`;

  const claudeCurlExample = `curl ${claudeProxyUrl}/v1/messages \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: \$ANTHROPIC_API_KEY" \\
  -H "x-proxy-key: ${customSecret}" \\
  -H "x-department: Engineering" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'`;

  const openaiSdkExample = `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "${openaiProxyUrl}",
  defaultHeaders: {
    "x-proxy-key": "${customSecret}",
    "x-department": "Marketing",
    "x-user-email": "user@company.com",
  },
});

// Use normally — all calls are automatically logged
const completion = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});`;

  const openaiCurlExample = `curl ${openaiProxyUrl} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer \$OPENAI_API_KEY" \\
  -H "x-proxy-key: ${customSecret}" \\
  -H "x-department: Marketing" \\
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`;

  const pythonClaudeExample = `import anthropic

client = anthropic.Anthropic(
    api_key=os.environ["ANTHROPIC_API_KEY"],
    base_url="${claudeProxyUrl}",
    default_headers={
        "x-proxy-key": "${customSecret}",
        "x-department": "Data Science",
        "x-user-email": "analyst@company.com",
    },
)

message = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}],
)`;

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
)`;

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
            Route all Claude and ChatGPT API calls through the governance proxy to automatically log usage, track costs, and enforce policies across your organization.
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
                <p className="text-xs font-semibold text-[var(--text-primary)]">Zero Code Changes</p>
                <p className="text-[11px] text-[var(--text-faint)] mt-0.5">Just change the base URL. All SDK features work normally.</p>
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
                  placeholder="https://nammu.yourcompany.com"
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
              Edit these values to generate correct code snippets below. The proxy secret must match the <code className="bg-[var(--bg-elevated)] px-1 rounded">PROXY_SECRET</code> environment variable on the server.
            </p>
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
              {/* Step 1 */}
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

              {/* Step 2 */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-dim)] text-[10px] font-bold text-[var(--accent)]">2</span>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Paste this JSON into managed settings</p>
                </div>
                <div className="ml-7">
                  <CopyBlock code={claudeCodeManagedSettings} />
                </div>
              </div>

              {/* Step 3 */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-dim)] text-[10px] font-bold text-[var(--accent)]">3</span>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Save</p>
                </div>
                <p className="text-xs text-[var(--text-muted)] ml-7">
                  All Claude Code sessions will now route through your proxy. This setting has the highest priority &mdash; users cannot override it.
                </p>
              </div>

              <div className="ml-7 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <p className="text-xs text-[var(--warning)]">
                  <strong>Requires Claude for Teams or Enterprise.</strong> Free and Pro plans do not have access to managed settings. Use the per-user method instead.
                </p>
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
        </CardContent>
      </Card>

      {/* SDK Integration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Braces className="h-4 w-4 text-[var(--accent)]" />
            SDK Integration &mdash; Claude &amp; ChatGPT
          </CardTitle>
          <CardDescription>
            For applications using the Anthropic or OpenAI SDKs directly, change the base URL to route through the proxy.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Tabs defaultValue="claude-ts">
            <TabsList className="flex-wrap">
              <TabsTrigger value="claude-ts">Claude (TypeScript)</TabsTrigger>
              <TabsTrigger value="claude-py">Claude (Python)</TabsTrigger>
              <TabsTrigger value="openai-ts">ChatGPT (TypeScript)</TabsTrigger>
              <TabsTrigger value="openai-py">ChatGPT (Python)</TabsTrigger>
              <TabsTrigger value="curl">cURL</TabsTrigger>
            </TabsList>

            <TabsContent value="claude-ts" className="mt-4">
              <CopyBlock code={claudeSdkExample} label="Anthropic TypeScript SDK" />
            </TabsContent>

            <TabsContent value="claude-py" className="mt-4">
              <CopyBlock code={pythonClaudeExample} label="Anthropic Python SDK" />
            </TabsContent>

            <TabsContent value="openai-ts" className="mt-4">
              <CopyBlock code={openaiSdkExample} label="OpenAI TypeScript SDK" />
            </TabsContent>

            <TabsContent value="openai-py" className="mt-4">
              <CopyBlock code={pythonOpenaiExample} label="OpenAI Python SDK" />
            </TabsContent>

            <TabsContent value="curl" className="mt-4 space-y-4">
              <CopyBlock code={claudeCurlExample} label="Claude via cURL" />
              <CopyBlock code={openaiCurlExample} label="ChatGPT via cURL" />
            </TabsContent>
          </Tabs>

          {/* Headers reference */}
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-3">
              Request Headers Reference
            </p>
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-[140px_60px_1fr] gap-2 items-start">
                <code className="text-[var(--accent)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded">x-proxy-key</code>
                <span className="text-[var(--critical)]">required</span>
                <span className="text-[var(--text-muted)]">Must match PROXY_SECRET on the server</span>
              </div>
              <div className="grid grid-cols-[140px_60px_1fr] gap-2 items-start">
                <code className="text-[var(--accent)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded">x-api-key</code>
                <span className="text-[var(--text-faint)]">optional</span>
                <span className="text-[var(--text-muted)]">Anthropic API key (falls back to server default)</span>
              </div>
              <div className="grid grid-cols-[140px_60px_1fr] gap-2 items-start">
                <code className="text-[var(--accent)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded">x-department</code>
                <span className="text-[var(--text-faint)]">optional</span>
                <span className="text-[var(--text-muted)]">Department name for cost attribution</span>
              </div>
              <div className="grid grid-cols-[140px_60px_1fr] gap-2 items-start">
                <code className="text-[var(--accent)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded">x-user-email</code>
                <span className="text-[var(--text-faint)]">optional</span>
                <span className="text-[var(--text-muted)]">User email to link usage to a platform user</span>
              </div>
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
                Provider, model, and API version
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-3 w-3 text-[var(--success)]" />
                Input and output token counts
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-3 w-3 text-[var(--success)]" />
                Estimated cost (built-in pricing tables)
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-3 w-3 text-[var(--success)]" />
                Department and user attribution
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-3 w-3 text-[var(--success)]" />
                Response latency
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-3 w-3 text-[var(--success)]" />
                Errors and flagged requests
              </div>
            </div>
            <p className="text-[10px] text-[var(--text-faint)] mt-3">
              Prompt and response content is <strong>never</strong> stored. Only metadata is logged.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
