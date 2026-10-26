"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  Check,
  Copy,
  Globe,
  Loader2,
  Plus,
  Power,
  PowerOff,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import type { NetworkProxyMode, NetworkRuleAction } from "@/lib/network-rules";

export type NetworkRuleRow = {
  id: string;
  pattern: string;
  action: NetworkRuleAction;
  enabled: boolean;
  reason: string | null;
  createdAt: string;
  createdBy: { name: string | null; email: string | null } | null;
};

export type NetworkRequestRow = {
  id: string;
  proxy: string;
  method: string;
  host: string;
  path: string;
  action: string;
  status: number | null;
  rulePattern: string | null;
  ruleSource: string | null;
  reason: string | null;
  userEmail: string | null;
  createdAt: string;
};

interface Props {
  currentMode: NetworkProxyMode;
  rules: NetworkRuleRow[];
  recent: NetworkRequestRow[];
  /** Vercel route base, e.g. https://app.example/api/proxy/net */
  vercelBase: string;
  /** Azure Functions base when the function app is known, else "". */
  azureBase: string;
  shadowBlockedCount: number;
}

const MODES: Array<{ id: NetworkProxyMode; name: string; description: string; color: string }> = [
  {
    id: "off",
    name: "Off",
    description: "The /proxy/net route refuses every request (404). Default.",
    color: "var(--text-muted)",
  },
  {
    id: "monitor",
    name: "Monitor",
    description:
      "Requests are forwarded even when a rule matches; matches are recorded as \"monitored\" so you can tune rules before enforcing.",
    color: "var(--warning)",
  },
  {
    id: "enforce",
    name: "Enforce",
    description: "Requests matching a block rule or a Shadow AI blocked domain get 403 and never leave the proxy.",
    color: "var(--critical)",
  },
];

function ModeIcon({ id }: { id: NetworkProxyMode }) {
  if (id === "off") return <Shield className="h-4 w-4" />;
  if (id === "monitor") return <ShieldAlert className="h-4 w-4" />;
  return <ShieldCheck className="h-4 w-4" />;
}

function CopyBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group">
      {label && (
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1.5">{label}</p>
      )}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-deep)] overflow-hidden">
        <pre className="p-4 text-[12px] leading-relaxed font-mono text-[var(--text-secondary)] overflow-x-auto whitespace-pre">
          {code}
        </pre>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="absolute top-2 right-2 rounded-md p-1.5 text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors opacity-0 group-hover:opacity-100"
          title="Copy to clipboard"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    return JSON.parse(text).error ?? `HTTP ${res.status}`;
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

function actionBadge(action: string) {
  switch (action) {
    case "blocked":
      return <Badge variant="critical">blocked</Badge>;
    case "monitored":
      return <Badge variant="warning">monitored</Badge>;
    case "error":
      return <Badge variant="high">error</Badge>;
    default:
      return <Badge variant="success">forwarded</Badge>;
  }
}

export function NetworkProxySettings({ currentMode, rules, recent, vercelBase, azureBase, shadowBlockedCount }: Props) {
  const router = useRouter();

  // ── Mode ──
  const [mode, setMode] = useState<NetworkProxyMode>(currentMode);
  const [savingMode, setSavingMode] = useState(false);
  const [modeResult, setModeResult] = useState<string | null>(null);

  async function saveMode() {
    setSavingMode(true);
    setModeResult(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network_proxy_mode: mode === "off" ? null : mode }),
      });
      setModeResult(res.ok ? "Network proxy mode saved. Proxies pick it up within a minute." : `Failed: ${await readError(res)}`);
      if (res.ok) router.refresh();
    } catch {
      setModeResult("Failed to save.");
    } finally {
      setSavingMode(false);
    }
  }

  // ── Rules ──
  const [pattern, setPattern] = useState("");
  const [action, setAction] = useState<NetworkRuleAction>("BLOCK");
  const [reason, setReason] = useState("");
  const [busyRule, setBusyRule] = useState<string | null>(null);
  const [ruleResult, setRuleResult] = useState<string | null>(null);

  async function addRule() {
    setBusyRule("new");
    setRuleResult(null);
    try {
      const res = await fetch("/api/network-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: pattern.trim(), action, reason: reason.trim() || null }),
      });
      if (res.ok) {
        setPattern("");
        setReason("");
        setRuleResult("Rule added.");
        router.refresh();
      } else {
        setRuleResult(`Failed: ${await readError(res)}`);
      }
    } catch {
      setRuleResult("Failed to add rule.");
    } finally {
      setBusyRule(null);
    }
  }

  async function toggleRule(rule: NetworkRuleRow) {
    setBusyRule(rule.id);
    setRuleResult(null);
    try {
      const res = await fetch(`/api/network-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      if (res.ok) router.refresh();
      else setRuleResult(`Failed: ${await readError(res)}`);
    } finally {
      setBusyRule(null);
    }
  }

  async function deleteRule(rule: NetworkRuleRow) {
    if (!confirm(`Delete the ${rule.action.toLowerCase()} rule "${rule.pattern}"?`)) return;
    setBusyRule(rule.id);
    setRuleResult(null);
    try {
      const res = await fetch(`/api/network-rules/${rule.id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
      else setRuleResult(`Failed: ${await readError(res)}`);
    } finally {
      setBusyRule(null);
    }
  }

  // ── URL tester ──
  const [testUrl, setTestUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ decision: string; reason: string; url?: string } | null>(null);

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/network-rules/test?url=${encodeURIComponent(testUrl.trim())}`);
      const data = await res.json();
      setTestResult(res.ok ? { decision: data.decision, reason: data.reason, url: data.url } : { decision: "error", reason: data.error ?? `HTTP ${res.status}` });
    } catch {
      setTestResult({ decision: "error", reason: "Request failed." });
    } finally {
      setTesting(false);
    }
  }

  const base = azureBase || vercelBase;
  const curl = `curl "${base}/api.github.com/repos/JuanNephrota/UrNammu" \\
  -H "x-proxy-key: $PROXY_SECRET" \\
  -H "x-user-email: $PROXY_USER_EMAIL"`;
  const sdk = `// Any HTTP client: replace the origin with the proxy + host.
//   https://api.example.com/v1/items
//   -> ${base}/api.example.com/v1/items
const res = await fetch("${base}/api.example.com/v1/items", {
  headers: { "x-proxy-key": process.env.PROXY_SECRET!, authorization: "Bearer <upstream token>" },
});`;

  const decisionColor = (d: string) =>
    d === "allowed" ? "var(--success)" : d === "blocked" ? "var(--critical)" : d === "monitored" ? "var(--warning)" : "var(--text-muted)";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-[var(--accent)]" />
          Network Proxy &amp; URL Blocking
        </CardTitle>
        <CardDescription>
          A general HTTPS forwarder at <code className="text-[var(--accent)]">/api/proxy/net/&lt;host&gt;/&lt;path&gt;</code> on both proxies.
          Every request is checked against the block rules below and the Shadow AI denylist ({shadowBlockedCount} blocked{" "}
          {shadowBlockedCount === 1 ? "domain" : "domains"}), then logged. Rules apply to every host; nothing is parsed or priced.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Mode */}
        <div className="space-y-2">
          <Label>Mode</Label>
          <div className="grid gap-2">
            {MODES.map((m) => {
              const selected = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setMode(m.id);
                    setModeResult(null);
                  }}
                  className="flex items-start gap-3 rounded-lg border p-3 text-left transition-all"
                  style={{
                    borderColor: selected ? m.color : "var(--border-subtle)",
                    backgroundColor: selected ? `color-mix(in srgb, ${m.color} 6%, var(--bg-base))` : "var(--bg-base)",
                  }}
                >
                  <span className="mt-0.5" style={{ color: selected ? m.color : "var(--text-faint)" }}>
                    <ModeIcon id={m.id} />
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-[var(--text-primary)]">{m.name}</span>
                    <span className="block text-xs text-[var(--text-muted)]">{m.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={saveMode} disabled={savingMode || mode === currentMode}>
              {savingMode ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {savingMode ? "Saving..." : "Save Mode"}
            </Button>
            {modeResult && (
              <p className={`text-sm font-medium ${modeResult.startsWith("Failed") ? "text-[var(--critical)]" : "text-[var(--success)]"}`}>
                {modeResult}
              </p>
            )}
          </div>
        </div>

        {/* Endpoint */}
        <div className="space-y-3 border-t border-[var(--border-subtle)] pt-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">Endpoint</p>
          {azureBase ? <CopyBlock code={azureBase} label="Azure Functions (primary)" /> : null}
          <CopyBlock code={vercelBase} label={azureBase ? "Vercel fallback" : "Base URL"} />
          <CopyBlock code={curl} label="cURL" />
          <CopyBlock code={sdk} label="Any HTTP client" />
          <p className="text-[11px] text-[var(--text-muted)]">
            Only <code className="text-[var(--accent)]">https</code> upstreams on public hosts are proxied; loopback, link-local and
            private ranges are refused. Redirects are rewritten back through the proxy. Attribution headers (
            <code className="text-[var(--accent)]">x-user-email</code>, <code className="text-[var(--accent)]">x-department</code>,{" "}
            <code className="text-[var(--accent)]">x-ai-system-id</code>, <code className="text-[var(--accent)]">x-agent-id</code>) work as on
            the provider routes; a suspended agent is refused here too.
          </p>
        </div>

        {/* Rules */}
        <div className="space-y-3 border-t border-[var(--border-subtle)] pt-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">Block Rules</p>
          <p className="text-[11px] text-[var(--text-muted)]">
            Patterns: <code className="text-[var(--accent)]">example.com</code> (host + subdomains),{" "}
            <code className="text-[var(--accent)]">*.example.com</code> (subdomains only),{" "}
            <code className="text-[var(--accent)]">example.com/v1/files</code> (path prefix),{" "}
            <code className="text-[var(--accent)]">example.com/v1/file*</code> (string prefix),{" "}
            <code className="text-[var(--accent)]">example.com:8443</code> (port), <code className="text-[var(--accent)]">*</code> (everything —
            pair with Allow rules for default-deny). An <strong>Allow</strong> rule always wins over a Block rule or a Shadow AI block.
          </p>

          <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto] items-end">
            <div className="space-y-1">
              <Label htmlFor="net-rule-pattern">Pattern</Label>
              <Input id="net-rule-pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="pastebin.com" className="font-mono" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="net-rule-action">Action</Label>
              <select
                id="net-rule-action"
                value={action}
                onChange={(e) => setAction(e.target.value as NetworkRuleAction)}
                className="h-9 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              >
                <option value="BLOCK">Block</option>
                <option value="ALLOW">Allow</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="net-rule-reason">Reason (shown to the caller)</Label>
              <Input id="net-rule-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Data exfiltration risk" />
            </div>
            <Button onClick={addRule} disabled={busyRule !== null || !pattern.trim()}>
              {busyRule === "new" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Add
            </Button>
          </div>
          {ruleResult && (
            <p className={`text-sm font-medium ${ruleResult.startsWith("Failed") ? "text-[var(--critical)]" : "text-[var(--success)]"}`}>
              {ruleResult}
            </p>
          )}

          {rules.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No rules yet. {shadowBlockedCount > 0 ? "Shadow AI blocked domains are still denied." : "Everything is forwarded."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--bg-base)] text-[11px] uppercase tracking-wider text-[var(--text-faint)]">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Pattern</th>
                    <th className="px-3 py-2 text-left font-semibold">Action</th>
                    <th className="px-3 py-2 text-left font-semibold">Reason</th>
                    <th className="px-3 py-2 text-left font-semibold">Added</th>
                    <th className="px-3 py-2 text-right font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id} className="border-t border-[var(--border-subtle)]" style={{ opacity: rule.enabled ? 1 : 0.5 }}>
                      <td className="px-3 py-2 font-mono text-[var(--text-primary)]">{rule.pattern}</td>
                      <td className="px-3 py-2">
                        {rule.action === "ALLOW" ? <Badge variant="success">allow</Badge> : <Badge variant="critical">block</Badge>}
                        {!rule.enabled && <span className="ml-2 text-[11px] text-[var(--text-faint)]">disabled</span>}
                      </td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{rule.reason ?? "—"}</td>
                      <td className="px-3 py-2 text-[var(--text-faint)] text-xs whitespace-nowrap">
                        {formatDateTime(rule.createdAt)}
                        {rule.createdBy?.email ? <span className="block">{rule.createdBy.name ?? rule.createdBy.email}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => toggleRule(rule)} disabled={busyRule !== null} title={rule.enabled ? "Disable" : "Enable"}>
                          {rule.enabled ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteRule(rule)} disabled={busyRule !== null} title="Delete">
                          <Trash2 className="h-3.5 w-3.5 text-[var(--critical)]" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Tester */}
        <div className="space-y-2 border-t border-[var(--border-subtle)] pt-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">Test a URL</p>
          <div className="flex gap-2">
            <Input value={testUrl} onChange={(e) => setTestUrl(e.target.value)} placeholder="https://api.example.com/v1/files" className="font-mono" />
            <Button variant="outline" onClick={runTest} disabled={testing || !testUrl.trim()} title="Test URL" aria-label="Test URL">
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
          {testResult && (
            <p className="text-sm">
              <span className="font-semibold uppercase" style={{ color: decisionColor(testResult.decision) }}>
                {testResult.decision}
              </span>{" "}
              <span className="text-[var(--text-muted)]">{testResult.reason}</span>
            </p>
          )}
        </div>

        {/* Recent */}
        <div className="space-y-2 border-t border-[var(--border-subtle)] pt-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">Recent Requests</p>
          {recent.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No requests through the network proxy yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--bg-base)] text-[11px] uppercase tracking-wider text-[var(--text-faint)]">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">When</th>
                    <th className="px-3 py-2 text-left font-semibold">Verdict</th>
                    <th className="px-3 py-2 text-left font-semibold">Request</th>
                    <th className="px-3 py-2 text-left font-semibold">Status</th>
                    <th className="px-3 py-2 text-left font-semibold">Rule</th>
                    <th className="px-3 py-2 text-left font-semibold">User</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((row) => (
                    <tr key={row.id} className="border-t border-[var(--border-subtle)]">
                      <td className="px-3 py-2 text-xs text-[var(--text-faint)] whitespace-nowrap">{formatDateTime(row.createdAt)}</td>
                      <td className="px-3 py-2">{actionBadge(row.action)}</td>
                      <td className="px-3 py-2 font-mono text-xs text-[var(--text-primary)]">
                        <span className="text-[var(--text-faint)]">{row.method} </span>
                        {row.host}
                        <span className="text-[var(--text-muted)]">{row.path}</span>
                      </td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{row.status ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-[var(--text-muted)]">
                        {row.rulePattern ? <code>{row.rulePattern}</code> : row.reason ?? "—"}
                        {row.ruleSource === "shadow_ai" && <Ban className="inline h-3 w-3 ml-1 text-[var(--critical)]" />}
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{row.userEmail ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
