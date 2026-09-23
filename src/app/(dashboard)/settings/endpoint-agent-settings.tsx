"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Laptop, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Props {
  hasSecret: boolean;
  platformUrl: string;
  reportIntervalSeconds: string;
  enabledCollectors: Record<string, boolean>;
  deviceCount: number;
}

const COLLECTORS: Array<{ id: string; label: string; description: string }> = [
  {
    id: "apps",
    label: "Apps",
    description: "Installed and running AI applications.",
  },
  {
    id: "browser",
    label: "Browser",
    description:
      "AI hostnames from browser history, filtered against the allowlist. Hostname and visit count only — never URLs or page titles.",
  },
  {
    id: "network",
    label: "Network",
    description:
      "AI hostnames from the DNS cache. Windows only; macOS has no unprivileged DNS cache to read.",
  },
  {
    id: "runtimes",
    label: "Local runtimes",
    description:
      "Model servers listening on loopback (Ollama, LM Studio, vLLM). The signal no other source can produce.",
  },
  {
    id: "agents",
    label: "MCP servers & agent frameworks",
    description:
      "MCP servers configured in Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, Zed, Continue, Gemini CLI and Codex, plus agent SDKs installed in well-known locations. Server name, transport, remote hostname and package id only — never commands, arguments, env, headers or URLs. Feeds Agents → Discovered.",
  },
];

function CopyBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative">
      <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-deep)]">
        <pre className="overflow-x-auto whitespace-pre p-4 font-mono text-[12px] leading-relaxed text-[var(--text-secondary)]">
          {code}
        </pre>
        <button
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="absolute right-2 top-2 rounded-md p-1.5 text-[var(--text-faint)] opacity-0 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] group-hover:opacity-100"
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

/** 64-char hex secret generated client-side for the admin to save. */
function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function EndpointAgentSettings({
  hasSecret,
  platformUrl,
  reportIntervalSeconds,
  enabledCollectors,
  deviceCount,
}: Props) {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [interval, setInterval] = useState(reportIntervalSeconds || "900");
  const [collectors, setCollectors] = useState(enabledCollectors);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function persist(updates: Record<string, string | null>, message: string) {
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = `HTTP ${res.status}`;
        try {
          msg = JSON.parse(text).error ?? msg;
        } catch {
          msg = text || msg;
        }
        setResult(`Failed: ${msg}`);
        return;
      }
      setResult(message);
      setSecret("");
      router.refresh();
    } catch (err) {
      setResult(
        `Failed to save: ${err instanceof Error ? err.message : "Network error"}`,
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRotate() {
    if (
      hasSecret &&
      !confirm(
        "Rotate the enrollment secret? Already-enrolled devices keep working — they use their own per-device tokens — but any MDM script still carrying the old secret will fail to enroll new machines until you update it.",
      )
    ) {
      return;
    }
    await persist(
      { endpoint_agent_enrollment_secret: secret || generateSecret() },
      "Enrollment secret saved. Update the MDM deploy scripts with the new value.",
    );
  }

  async function handleSaveCollectors(next: Record<string, boolean>) {
    setCollectors(next);
    const enabled = COLLECTORS.filter((c) => next[c.id]).map((c) => c.id);
    await persist(
      { endpoint_agent_collectors: enabled.join(",") },
      "Collector selection saved. Agents pick it up on their next manifest fetch.",
    );
  }

  const configExample = `{
  "consoleUrl": "${platformUrl}",
  "enrollmentSecret": "$ENDPOINT_AGENT_ENROLLMENT_SECRET",
  "userEmail": "person@example.com"
}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Laptop className="h-4 w-4 text-[var(--accent)]" />
          Endpoint Agent
        </CardTitle>
        <CardDescription>
          A signed binary pushed by MDM to macOS and Windows that reports which AI
          tools a machine actually runs and reaches — covering the laptops that
          network and SaaS-side sources go blind on. It reports identifiers and
          counts only: never prompts, responses, URLs, page titles or file paths.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
            hasSecret
              ? "border-[var(--success-border)] bg-[var(--success-dim)] text-[var(--success-strong)]"
              : "border-[var(--warning-border)] bg-[var(--warning-dim)] text-[var(--warning-strong)]"
          }`}
        >
          {hasSecret ? <ShieldCheck className="h-4 w-4" /> : <X className="h-4 w-4" />}
          <span>
            {hasSecret
              ? `Enrollment is configured. ${deviceCount} device${deviceCount === 1 ? "" : "s"} enrolled.`
              : "No enrollment secret set — the enroll endpoint returns 503 and no agent can enroll."}
          </span>
        </div>

        {/* Enrollment secret */}
        <div className="space-y-2">
          <Label htmlFor="endpoint-secret">Enrollment secret</Label>
          <p className="text-xs text-[var(--text-faint)]">
            Shipped to every managed machine by MDM, and traded once for a
            per-device token. It is deliberately low-value: it can enroll a device
            and nothing else — it cannot read the fleet or resurrect a revoked
            machine. Leave the field blank to generate a random 256-bit value.
          </p>
          <div className="flex gap-2">
            <Input
              id="endpoint-secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={hasSecret ? "Encrypted — enter a value to replace" : "Leave blank to generate"}
              autoComplete="off"
            />
            <Button onClick={handleRotate} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="ml-2">{hasSecret ? "Rotate" : "Generate"}</span>
            </Button>
          </div>
        </div>

        {/* Report interval */}
        <div className="space-y-2">
          <Label htmlFor="endpoint-interval">Report interval (seconds)</Label>
          <p className="text-xs text-[var(--text-faint)]">
            How often each agent collects and reports. Delivered in the manifest, so
            a change applies fleet-wide without redeploying. Clamped to 60–86400;
            the default is 900.
          </p>
          <div className="flex gap-2">
            <Input
              id="endpoint-interval"
              type="number"
              min={60}
              max={86400}
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              className="max-w-[200px]"
            />
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() =>
                persist(
                  { endpoint_agent_report_interval_seconds: interval || null },
                  "Report interval saved.",
                )
              }
            >
              Save
            </Button>
          </div>
        </div>

        {/* Collectors */}
        <div className="space-y-2">
          <Label>Collectors</Label>
          <p className="text-xs text-[var(--text-faint)]">
            Turning a collector off stops that data being gathered on every machine
            from its next manifest fetch — no redeploy needed.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {COLLECTORS.map((collector) => (
              <label
                key={collector.id}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 hover:bg-[var(--bg-hover)]"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={collectors[collector.id] ?? true}
                  disabled={saving}
                  onChange={(e) =>
                    handleSaveCollectors({
                      ...collectors,
                      [collector.id]: e.target.checked,
                    })
                  }
                />
                <span>
                  <span className="block text-sm text-[var(--text-primary)]">
                    {collector.label}
                  </span>
                  <span className="block text-xs text-[var(--text-faint)]">
                    {collector.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Deployment */}
        <div className="space-y-2">
          <Label>Deployment</Label>
          <p className="text-xs text-[var(--text-faint)]">
            Build and sign with{" "}
            <code className="text-[var(--text-secondary)]">ops/endpoint-agent</code>,
            then push the Hexnode script for each platform with{" "}
            <code className="text-[var(--text-secondary)]">CONSOLE_URL</code>,{" "}
            <code className="text-[var(--text-secondary)]">ENROLLMENT_SECRET</code> and{" "}
            <code className="text-[var(--text-secondary)]">BINARY_URL</code> set. MDM
            writes this config to each machine:
          </p>
          <CopyBlock code={configExample} />
          <p className="text-xs text-[var(--text-faint)]">
            Unsigned binaries are blocked by Gatekeeper and flagged by SmartScreen,
            and both deploy scripts refuse to install one. Safari history also needs
            a PPPC profile granting Full Disk Access, or Safari is skipped and the
            device shows the browser collector as partial.
          </p>
        </div>

        {result && (
          <p
            className={`text-sm ${
              result.startsWith("Failed")
                ? "text-[var(--critical)]"
                : "text-[var(--success)]"
            }`}
          >
            {result}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
