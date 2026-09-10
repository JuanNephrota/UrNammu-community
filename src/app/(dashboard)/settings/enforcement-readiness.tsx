"use client";

import { useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Loader2,
  ShieldCheck,
  ShieldX,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

interface Props {
  feedTokenSet: boolean;
  microsoftConfigured: boolean;
  googleConfigured: boolean;
}

type Level = "armed" | "partial" | "off";

function StatusIcon({ level }: { level: Level }) {
  if (level === "armed") return <CheckCircle2 className="h-5 w-5 text-[var(--success)]" />;
  if (level === "partial") return <CircleAlert className="h-5 w-5 text-[var(--warning)]" />;
  return <XCircle className="h-5 w-5 text-[var(--text-faint)]" />;
}

function Row({
  level,
  title,
  detail,
  children,
}: {
  level: Level;
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-3">
      <StatusIcon level={level} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
            style={{
              color:
                level === "armed"
                  ? "var(--success)"
                  : level === "partial"
                    ? "var(--warning)"
                    : "var(--text-faint)",
              background:
                level === "armed"
                  ? "rgba(16,185,129,0.1)"
                  : level === "partial"
                    ? "rgba(245,158,11,0.1)"
                    : "rgba(148,163,184,0.1)",
            }}
          >
            {level === "armed" ? "Armed" : level === "partial" ? "Needs setup" : "Off"}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">{detail}</p>
        {children}
      </div>
    </div>
  );
}

export function EnforcementReadiness({
  feedTokenSet,
  microsoftConfigured,
  googleConfigured,
}: Props) {
  const [checking, setChecking] = useState(false);
  const [msCheck, setMsCheck] = useState<{ ok: boolean; message: string } | null>(null);

  async function verifyMicrosoft() {
    setChecking(true);
    setMsCheck(null);
    try {
      const res = await fetch("/api/settings/test-microsoft-enforcement", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        setMsCheck({ ok: false, message: data.error ?? `HTTP ${res.status}` });
      } else {
        setMsCheck({ ok: !!data.hasPermission, message: data.message });
      }
    } catch (err) {
      setMsCheck({
        ok: false,
        message: `Check failed: ${err instanceof Error ? err.message : "Network error"}`,
      });
    } finally {
      setChecking(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[var(--accent)]" />
          Block Enforcement Readiness
        </CardTitle>
        <CardDescription>
          Which enforcement paths are actually armed when you Block a discovered tool. Blocking
          is best-effort across all three — each covers a gap the others can&apos;t.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Network feed */}
        <Row
          level={feedTokenSet ? "armed" : "partial"}
          title="Network — Blocklist feed"
          detail={
            feedTokenSet
              ? "Feed token is set. Blocked domains are published for a DNS/proxy/firewall/CASB to enforce."
              : "No feed token set — the feed returns 503. Set one in the Blocklist Feed card below."
          }
        />

        {/* Microsoft */}
        <Row
          level={microsoftConfigured ? (msCheck ? (msCheck.ok ? "armed" : "partial") : "partial") : "off"}
          title="Identity — Microsoft 365 (Entra)"
          detail={
            microsoftConfigured
              ? "Connected. Blocking disables the enterprise app's sign-ins — requires Application.ReadWrite.All consent."
              : "Not configured. Add Microsoft 365 credentials to enable identity-layer blocking."
          }
        >
          {microsoftConfigured && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button size="sm" variant="outline" onClick={verifyMicrosoft} disabled={checking}>
                {checking ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldX className="mr-2 h-3.5 w-3.5" />
                )}
                {checking ? "Checking..." : "Verify permission"}
              </Button>
              {msCheck && (
                <span
                  className="text-xs"
                  style={{ color: msCheck.ok ? "var(--success)" : "var(--critical)" }}
                >
                  {msCheck.message}
                </span>
              )}
            </div>
          )}
        </Row>

        {/* Google */}
        <Row
          level={googleConfigured ? "armed" : "off"}
          title="Identity — Google Workspace"
          detail={
            googleConfigured
              ? "Connected. Blocking revokes the app's OAuth grants (existing scopes — no extra consent). Users can re-authorize unless you set the org-wide “block all unconfigured apps” policy."
              : "Not configured. Add Google Workspace credentials to enable OAuth grant revocation."
          }
        />
      </CardContent>
    </Card>
  );
}
