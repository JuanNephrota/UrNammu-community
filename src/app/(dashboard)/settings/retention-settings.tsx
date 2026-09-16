"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Database, Loader2 } from "lucide-react";
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
import {
  RETENTION_DEFAULTS,
  RETENTION_ENV_VARS,
  RETENTION_SETTING_KEYS,
  resolveRetentionDays,
  type RetentionSettingKey,
} from "@/lib/collection-retention";
import type { RetentionSettingValue } from "./data";

const ROWS: Array<{
  key: RetentionSettingKey;
  label: string;
  tables: string;
  note: string;
}> = [
  {
    key: "api_usage_log_retention_days",
    label: "Proxy request log",
    tables: "APIUsageLog",
    note: "Per-request rows from the proxy. Hourly/daily usage and cost buckets keep the totals.",
  },
  {
    key: "agent_tool_call_retention_days",
    label: "Agent tool calls",
    tables: "AgentToolCall",
    note: "Individual MCP / tool invocations. Agent tool profiles keep the counts.",
  },
  {
    key: "policy_denial_retention_days",
    label: "Policy denials",
    tables: "PolicyDenial",
    note: "Dry-run and enforced policy denial events with prompt excerpts.",
  },
  {
    key: "raw_snapshot_retention_days",
    label: "Provider raw snapshots",
    tables: "ProviderRawSnapshot",
    note: "Raw admin-API payloads captured during provider syncs, kept for debugging.",
  },
  {
    key: "proxy_health_retention_days",
    label: "Proxy health snapshots",
    tables: "ProxyHealthSnapshot",
    note: "Azure Monitor samples behind the Proxy Health board.",
  },
  {
    key: "scan_result_retention_days",
    label: "Scan runs",
    tables: "SensitiveScan · ProviderSecurityScan",
    note: "Sensitive-scan and provider-security runs with their findings. The newest run per provider is always kept.",
  },
  {
    key: "claude_code_telemetry_retention_days",
    label: "Claude Code telemetry",
    tables: "ClaudeCodeMetric · ClaudeCodeEvent",
    note: "OTel metrics and events behind the Claude Code and Cowork dashboards.",
  },
  {
    key: "cursor_telemetry_retention_days",
    label: "Cursor telemetry",
    tables: "CursorMetric · CursorSpan",
    note: "OTel metrics and spans behind the Cursor dashboard.",
  },
];

interface Props {
  initial: Record<RetentionSettingKey, RetentionSettingValue>;
}

function isValidDays(value: string): boolean {
  return value === "" || /^\d+$/.test(value.trim());
}

export function RetentionSettings({ initial }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Record<RetentionSettingKey, string>>(() =>
    Object.fromEntries(
      RETENTION_SETTING_KEYS.map((key) => [key, initial[key].configured ?? ""])
    ) as Record<RetentionSettingKey, string>
  );
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const dirtyKeys = RETENTION_SETTING_KEYS.filter(
    (key) => values[key] !== (initial[key].configured ?? "")
  );
  const invalidKeys = RETENTION_SETTING_KEYS.filter((key) => !isValidDays(values[key]));
  const isDirty = dirtyKeys.length > 0;

  async function handleSave() {
    if (invalidKeys.length > 0) {
      setResult("Retention must be a whole number of days (0 disables pruning).");
      return;
    }
    setSaving(true);
    setResult(null);
    try {
      const body = Object.fromEntries(
        dirtyKeys.map((key) => [key, values[key].trim() === "" ? null : values[key].trim()])
      );
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setResult("Retention settings saved. They apply on the next nightly prune.");
        router.refresh();
      } else {
        const data = await res.json();
        setResult(`Failed: ${data.error}`);
      }
    } catch {
      setResult("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-4 w-4 text-[var(--accent)]" />
          Data Retention
        </CardTitle>
        <CardDescription>
          How long raw collection rows are kept before the nightly prune jobs
          delete them, in days. Leave a field blank to use the environment
          variable or built-in default shown beneath it. Enter <code>0</code> to
          disable pruning for that table. Usage and cost buckets are the
          long-term aggregate and are never pruned.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          {ROWS.map((row) => {
            const value = values[row.key];
            const envValue = initial[row.key].envValue;
            const fallbackDays = resolveRetentionDays(envValue, RETENTION_DEFAULTS[row.key]);
            const effective = resolveRetentionDays(
              value.trim() === "" ? null : value,
              fallbackDays
            );
            const invalid = !isValidDays(value);
            const inputId = `retention-${row.key}`;
            return (
              <div
                key={row.key}
                className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Label htmlFor={inputId}>{row.label}</Label>
                    <p className="mt-0.5 font-mono text-[10px] text-[var(--text-faint)]">
                      {row.tables}
                    </p>
                  </div>
                  <span
                    className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium"
                    style={{
                      backgroundColor:
                        effective === 0
                          ? "color-mix(in srgb, var(--warning) 15%, transparent)"
                          : "color-mix(in srgb, var(--accent) 12%, transparent)",
                      color: effective === 0 ? "var(--warning)" : "var(--accent)",
                    }}
                  >
                    {effective === 0 ? "pruning off" : `${effective} days`}
                  </span>
                </div>
                <Input
                  id={inputId}
                  inputMode="numeric"
                  placeholder={String(fallbackDays)}
                  value={value}
                  aria-invalid={invalid || undefined}
                  onChange={(e) => {
                    setValues((prev) => ({ ...prev, [row.key]: e.target.value }));
                    setResult(null);
                  }}
                  className={invalid ? "border-[var(--critical)]" : undefined}
                />
                <p className="text-[11px] leading-snug text-[var(--text-faint)]">
                  {row.note}
                </p>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Default {RETENTION_DEFAULTS[row.key]} days
                  {envValue != null ? (
                    <>
                      {" · "}
                      <code>{RETENTION_ENV_VARS[row.key]}</code>={envValue}
                    </>
                  ) : (
                    <>
                      {" · env "}
                      <code>{RETENTION_ENV_VARS[row.key]}</code>
                    </>
                  )}
                </p>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 border-t border-[var(--border-subtle)] pt-2">
          <Button onClick={handleSave} disabled={saving || !isDirty || invalidKeys.length > 0}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {saving ? "Saving..." : "Save Retention"}
          </Button>
          {result && (
            <p
              className={`text-sm font-medium ${
                result.includes("saved")
                  ? "text-[var(--success)]"
                  : "text-[var(--critical)]"
              }`}
            >
              {result}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
