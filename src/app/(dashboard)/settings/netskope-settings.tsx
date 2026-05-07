"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, Network, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface Props {
  webhookUrl: string;
  proxySecret: string;
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

export function NetskopeSettings({ webhookUrl, proxySecret }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Network className="h-4 w-4 text-[var(--accent)]" />
          Netskope Log Shipper
        </CardTitle>
        <CardDescription>
          Forward Netskope web transaction and application events to UrNammu for automatic shadow AI detection.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* How it works */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
            <Network className="h-4 w-4 text-[var(--accent)] shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-[var(--text-primary)]">Native Format</p>
              <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
                Accepts the Netskope log shipper&apos;s JSON event format — no transformation needed.
              </p>
            </div>
          </div>
          <div className="flex gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
            <ShieldCheck className="h-4 w-4 text-[var(--accent)] shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-[var(--text-primary)]">Bearer Token Auth</p>
              <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
                Uses the shared proxy secret as a Bearer token — set once in the Netskope admin console.
              </p>
            </div>
          </div>
          <div className="flex gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
            <Check className="h-4 w-4 text-[var(--accent)] shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-[var(--text-primary)]">Auto Detection</p>
              <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
                Domains are matched against known AI tools and alerts are raised for ungoverned discoveries.
              </p>
            </div>
          </div>
        </div>

        {/* Step 1 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-dim)] text-[10px] font-bold text-[var(--accent)]">1</span>
            <p className="text-sm font-medium text-[var(--text-primary)]">Open Netskope Admin Console &rarr; Settings &rarr; Tools &rarr; Log Shipper</p>
          </div>
          <p className="ml-7 text-xs text-[var(--text-muted)]">
            Go to{" "}
            <a
              href="https://docs.netskope.com/en/netskope-help/integrations-439107/netskope-cloud-log-shipper/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] hover:underline inline-flex items-center gap-0.5"
            >
              Netskope docs <ExternalLink className="h-2.5 w-2.5" />
            </a>
            {" "}for full log shipper setup instructions.
          </p>
        </div>

        {/* Step 2 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-dim)] text-[10px] font-bold text-[var(--accent)]">2</span>
            <p className="text-sm font-medium text-[var(--text-primary)]">Create a new HTTP destination with these values</p>
          </div>
          <div className="ml-7 space-y-3">
            <CopyBlock code={webhookUrl} label="Endpoint URL" />
            <div className="grid gap-3 sm:grid-cols-2">
              <CopyBlock code="Authorization" label="Authentication header name" />
              <CopyBlock code={`Bearer ${proxySecret}`} label="Authentication header value" />
            </div>
            <p className="text-[10px] text-[var(--text-faint)]">
              Set <strong>Method</strong> to <code className="bg-[var(--bg-elevated)] px-1 py-0.5 rounded text-[var(--accent)]">POST</code> and{" "}
              <strong>Content-Type</strong> to <code className="bg-[var(--bg-elevated)] px-1 py-0.5 rounded text-[var(--accent)]">application/json</code>.
            </p>
          </div>
        </div>

        {/* Step 3 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-dim)] text-[10px] font-bold text-[var(--accent)]">3</span>
            <p className="text-sm font-medium text-[var(--text-primary)]">Select event types to forward</p>
          </div>
          <p className="ml-7 text-xs text-[var(--text-muted)]">
            Enable <strong>Page</strong> and <strong>Application</strong> event types. Alert events are also supported. DNS-only tenants can enable <strong>DNS</strong> events — the <code className="bg-[var(--bg-elevated)] px-1 py-0.5 rounded text-[var(--accent)]">hostname</code> field is used automatically.
          </p>
        </div>

        {/* Payload reference */}
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">
            Accepted Payload Format
          </p>
          <p className="text-[11px] text-[var(--text-muted)]">
            The endpoint accepts the Netskope log shipper&apos;s native JSON output without modification. Both the standard <code className="bg-[var(--bg-elevated)] px-1 py-0.5 rounded text-[var(--accent)]">{`{"data":[...]}`}</code> envelope and raw event arrays are supported.
          </p>
          <CopyBlock
            label="Example payload"
            code={`{
  "data": [
    {
      "timestamp": 1746604800,
      "type": "page",
      "action": "allow",
      "app": "ChatGPT",
      "hostname": "chatgpt.com",
      "url": "https://chatgpt.com/c/abc123",
      "user": "alice@company.com",
      "organization_unit": "Engineering",
      "count": 3
    }
  ]
}`}
          />
          <div className="space-y-2 text-xs">
            <p className="text-[var(--text-faint)] font-semibold">Field mapping</p>
            <div className="grid gap-1.5">
              {[
                ["hostname · dstdomain · dst_hostname · url", "Destination domain (first non-empty wins)"],
                ["user · userkey", "User identity"],
                ["organization_unit", "Department"],
                ["count", "Request count (defaults to 1)"],
              ].map(([field, desc]) => (
                <div key={field} className="grid grid-cols-[240px_1fr] gap-2 items-start">
                  <code className="text-[var(--accent)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded text-[11px]">{field}</code>
                  <span className="text-[var(--text-muted)] text-[11px]">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
