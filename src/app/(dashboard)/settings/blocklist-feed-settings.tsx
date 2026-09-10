"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  Check,
  Copy,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
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

interface Props {
  feedUrl: string;
  hasToken: boolean;
  blockedCount: number;
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

/** 64-char hex token generated client-side for the admin to save. */
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function BlocklistFeedSettings({ feedUrl, hasToken, blockedCount }: Props) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);

  async function persist(value: string | null) {
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shadow_ai_blocklist_token: value }),
      });
      if (res.ok) {
        setSaveResult(value ? "Feed token saved." : "Feed token removed.");
        setToken("");
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
        `Failed to save: ${err instanceof Error ? err.message : "Network error"}`
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm("Remove the feed token? Polling clients will start getting 401s.")) return;
    await persist(null);
  }

  // Example shows the live URL; the placeholder token keeps the real secret out
  // of copyable snippets.
  const exampleToken = "$SHADOW_AI_BLOCKLIST_TOKEN";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Ban className="h-4 w-4 text-[var(--accent)]" />
          Blocklist Feed (Enforcement)
        </CardTitle>
        <CardDescription>
          Publish every <strong>Blocked</strong> discovery&apos;s domain so an external
          network control (DNS sinkhole, proxy ACL, firewall URL-list, or CASB) can
          poll this feed and actually deny access. UrNammu is not in the traffic
          path, so a block only enforces once a control consumes this list.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Status banner */}
        <div
          className="flex items-center gap-3 rounded-xl border px-5 py-4"
          style={{
            borderColor: hasToken ? "rgba(16, 185, 129, 0.2)" : "rgba(245, 158, 11, 0.2)",
            background: hasToken ? "rgba(16, 185, 129, 0.05)" : "rgba(245, 158, 11, 0.05)",
          }}
        >
          {hasToken ? (
            <>
              <Wifi className="h-5 w-5 text-[var(--success)]" />
              <div>
                <p className="text-sm font-medium text-[var(--success)]">Feed Active</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {blockedCount} blocked {blockedCount === 1 ? "domain is" : "domains are"}{" "}
                  currently published. Point your network control at the URL below.
                </p>
              </div>
            </>
          ) : (
            <>
              <WifiOff className="h-5 w-5 text-[var(--warning)]" />
              <div>
                <p className="text-sm font-medium text-[var(--warning)]">Feed Disabled</p>
                <p className="text-xs text-[var(--text-muted)]">
                  Set a feed token below to enable the endpoint. Until then it returns 503
                  and no domains are exposed.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Token management */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <KeyRound className="h-3.5 w-3.5" />
            Feed Token
          </Label>
          {hasToken ? (
            <div className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-3">
              <Check className="h-4 w-4 text-[var(--success)]" />
              <span className="text-sm text-[var(--text-muted)] flex-1">
                A feed token is configured (stored encrypted)
              </span>
              <Button size="sm" variant="ghost" onClick={handleRemove} disabled={saving}>
                <X className="h-3 w-3 mr-1" /> Remove
              </Button>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={hasToken ? "Paste a new token to rotate" : "Paste or generate a token"}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => setToken(generateToken())}
              disabled={saving}
              title="Generate a random 64-char token"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[10px] text-[var(--text-faint)]">
            Sent as <code className="text-[var(--accent)]">Authorization: Bearer &lt;token&gt;</code>{" "}
            by the polling client. Stored encrypted; falls back to the{" "}
            <code className="text-[var(--accent)]">SHADOW_AI_BLOCKLIST_TOKEN</code> env var.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => persist(token.trim())} disabled={saving || !token.trim()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {saving ? "Saving..." : hasToken ? "Rotate Token" : "Save Token"}
          </Button>
          {saveResult && (
            <p
              className={`text-sm font-medium ${
                saveResult.startsWith("Failed")
                  ? "text-[var(--critical)]"
                  : "text-[var(--success)]"
              }`}
            >
              {saveResult}
            </p>
          )}
        </div>

        {/* Feed URL + formats */}
        <div className="space-y-3 border-t border-[var(--border-subtle)] pt-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">
            Feed Endpoint
          </p>
          <CopyBlock code={feedUrl} label="URL" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
              <ShieldCheck className="h-4 w-4 text-[var(--accent)] shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-[var(--text-primary)]">Bearer Token Auth</p>
                <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
                  Unauthenticated requests get 401; an unset token returns 503 (fail closed).
                </p>
              </div>
            </div>
            <div className="flex gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
              <Ban className="h-4 w-4 text-[var(--accent)] shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-[var(--text-primary)]">Domains Only</p>
                <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
                  Blocked tools without a detected domain can&apos;t be enforced and are omitted.
                </p>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-[var(--text-muted)]">
            Choose an output format with <code className="text-[var(--accent)]">?format=</code>:
          </p>
          <CopyBlock
            label="Plain domains (default) — Squid dstdomain, dnsmasq, NextDNS, firewall URL-lists"
            code={`curl -H "Authorization: Bearer ${exampleToken}" \\\n  "${feedUrl}"`}
          />
          <CopyBlock
            label="Hosts file (0.0.0.0 domain) — Pi-hole / pfBlockerNG adlists"
            code={`curl -H "Authorization: Bearer ${exampleToken}" \\\n  "${feedUrl}?format=hosts"`}
          />
          <CopyBlock
            label="JSON (with vendor + timestamp metadata)"
            code={`curl -H "Authorization: Bearer ${exampleToken}" \\\n  "${feedUrl}?format=json"`}
          />
          <CopyBlock
            label="Proxy auto-config (PAC) — sinkholes blocked hosts to a dead proxy"
            code={`curl -H "Authorization: Bearer ${exampleToken}" \\\n  "${feedUrl}?format=pac"`}
          />
        </div>
      </CardContent>
    </Card>
  );
}
