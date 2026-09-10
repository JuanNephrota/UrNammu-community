"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Pencil, Plus, RotateCcw, Trash2, Play, AlertTriangle } from "lucide-react";

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
type Severity = (typeof SEVERITIES)[number];

const CONDITION_TYPES = [
  "VOLUME_THRESHOLD",
  "SPIKE_MULTIPLIER",
  "NEW_KEY",
  "DORMANT_REACTIVATION",
  "OFF_HOURS",
  "MODEL_ALLOWLIST",
  "FAN_OUT",
] as const;
type ConditionType = (typeof CONDITION_TYPES)[number];

const CONDITION_LABELS: Record<ConditionType, string> = {
  VOLUME_THRESHOLD: "Volume threshold",
  SPIKE_MULTIPLIER: "Spike vs. baseline",
  NEW_KEY: "New key",
  DORMANT_REACTIVATION: "Dormant key reactivated",
  OFF_HOURS: "Outside business hours",
  MODEL_ALLOWLIST: "Non-approved model",
  FAN_OUT: "Fan-out across projects/actors",
};

const CONDITION_HELP: Record<ConditionType, string> = {
  VOLUME_THRESHOLD: "Fires when a key's tokens, cost, or request count over the window exceeds an absolute ceiling.",
  SPIKE_MULTIPLIER: "Fires when the window's value is at least N times the immediately preceding baseline window. Keys with no baseline are skipped — use the New key condition for those.",
  NEW_KEY: "Fires the first time a key appears in telemetry with meaningful volume.",
  DORMANT_REACTIVATION: "Fires when a key idle for N days starts transacting again.",
  OFF_HOURS: "Fires on activity outside declared business hours. Needs hourly telemetry — provider Admin API sync reports daily totals only, so this evaluates proxy-ingested keys.",
  MODEL_ALLOWLIST: "Fires when a key invokes a model outside the allowlist. Matched as a case-insensitive substring, so \"claude-sonnet\" covers every dated release.",
  FAN_OUT: "Fires when one key spans more distinct projects or actors than expected.",
};

const SEVERITY_VARIANT: Record<Severity, "critical" | "high" | "medium" | "low" | "info"> = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  INFO: "info",
};

type RuleConfig = Record<string, unknown>;

export type KeyUsageRule = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  conditionType: ConditionType;
  severity: Severity;
  providers: string[];
  apiKeyExternalIds: string[];
  config: RuleConfig;
  enabled: boolean;
  builtIn: boolean;
};

type PreviewMatch = {
  provider: string;
  apiKeyExternalId: string;
  apiKeyName: string | null;
  reasons: string[];
};

/** Sensible starting config per condition, so a new rule is never empty. */
function defaultConfig(conditionType: ConditionType): RuleConfig {
  switch (conditionType) {
    case "VOLUME_THRESHOLD":
      return { conditionType, metric: "cost", windowHours: 24, threshold: 500 };
    case "SPIKE_MULTIPLIER":
      return {
        conditionType,
        metric: "cost",
        windowHours: 168,
        baselineHours: 168,
        multiplier: 3,
        minRecentCost: 25,
      };
    case "NEW_KEY":
      return { conditionType, windowHours: 24, minTokens: 10000 };
    case "DORMANT_REACTIVATION":
      return { conditionType, dormantDays: 30, windowHours: 24, minTokens: 5000 };
    case "OFF_HOURS":
      return {
        conditionType,
        windowHours: 24,
        businessHourStart: 7,
        businessHourEnd: 20,
        businessDays: [1, 2, 3, 4, 5],
        timezoneOffsetMinutes: 0,
        minTokens: 25000,
      };
    case "MODEL_ALLOWLIST":
      return { conditionType, windowHours: 24, allowedModels: [], minTokens: 1000 };
    case "FAN_OUT":
      return { conditionType, windowHours: 168, dimension: "project", maxDistinct: 5 };
  }
}

/** One-line plain-English rendering of a stored config, for the rule list. */
function summarizeConfig(rule: KeyUsageRule): string {
  const c = rule.config as Record<string, never> & Record<string, unknown>;
  const win = (h: unknown) => (typeof h === "number" && h % 24 === 0 ? `${h / 24}d` : `${String(h)}h`);
  switch (rule.conditionType) {
    case "VOLUME_THRESHOLD":
      return `${String(c.metric)} over ${String(c.threshold)} in ${win(c.windowHours)}`;
    case "SPIKE_MULTIPLIER":
      return `${String(c.metric)} ≥ ${String(c.multiplier)}x prior ${win(c.baselineHours)}, over ${win(c.windowHours)}`;
    case "NEW_KEY":
      return `first seen within ${win(c.windowHours)}`;
    case "DORMANT_REACTIVATION":
      return `idle ≥ ${String(c.dormantDays)}d, then active in ${win(c.windowHours)}`;
    case "OFF_HOURS":
      return `outside ${String(c.businessHourStart)}:00-${String(c.businessHourEnd)}:00, over ${win(c.windowHours)}`;
    case "MODEL_ALLOWLIST": {
      const models = Array.isArray(c.allowedModels) ? (c.allowedModels as string[]) : [];
      return models.length === 0
        ? "allowlist empty — rule inactive until configured"
        : `allowed: ${models.join(", ")}`;
    }
    case "FAN_OUT":
      return `> ${String(c.maxDistinct)} distinct ${String(c.dimension)}s in ${win(c.windowHours)}`;
  }
}

export function KeyUsageRulesManager({ initialRules }: { initialRules: KeyUsageRule[] }) {
  const router = useRouter();
  const [editingRule, setEditingRule] = useState<KeyUsageRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(() => router.refresh(), [router]);

  async function toggleEnabled(rule: KeyUsageRule) {
    setBusyId(rule.id);
    try {
      await fetch(`/api/key-usage-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function deleteCustom(rule: KeyUsageRule) {
    if (!confirm(`Delete custom rule "${rule.label}"? This cannot be undone.`)) return;
    setBusyId(rule.id);
    try {
      await fetch(`/api/key-usage-rules/${rule.id}`, { method: "DELETE" });
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function resetBuiltIn(rule: KeyUsageRule) {
    if (
      !confirm(
        `Reset "${rule.label}" to its default label, severity, scope, and thresholds? Current edits will be discarded.`
      )
    )
      return;
    setBusyId(rule.id);
    try {
      await fetch(`/api/key-usage-rules/${rule.id}/reset`, { method: "POST" });
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Key usage rules ({initialRules.length})</CardTitle>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1" /> New custom rule
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {initialRules.length === 0 && (
            <p className="text-sm text-[var(--text-secondary)]">
              No rules defined yet.
            </p>
          )}
          {initialRules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              busy={busyId === rule.id}
              onEdit={() => setEditingRule(rule)}
              onToggle={() => toggleEnabled(rule)}
              onDelete={() => deleteCustom(rule)}
              onReset={() => resetBuiltIn(rule)}
            />
          ))}
        </CardContent>
      </Card>

      {editingRule && (
        <RuleEditorDialog
          open
          rule={editingRule}
          onClose={() => setEditingRule(null)}
          onSaved={() => {
            setEditingRule(null);
            refresh();
          }}
        />
      )}

      {creating && (
        <RuleEditorDialog
          open
          rule={null}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function RuleRow({
  rule,
  busy,
  onEdit,
  onToggle,
  onDelete,
  onReset,
}: {
  rule: KeyUsageRule;
  busy: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onReset: () => void;
}) {
  const scope: string[] = [];
  if (rule.providers.length > 0) scope.push(`providers: ${rule.providers.join(", ")}`);
  if (rule.apiKeyExternalIds.length > 0)
    scope.push(`${rule.apiKeyExternalIds.length} specific key(s)`);

  return (
    <div
      className={`rounded-lg border p-4 transition-all ${
        rule.enabled
          ? "border-[var(--border-subtle)] bg-[var(--bg-surface)]"
          : "border-[var(--border-subtle)] bg-[var(--bg-base)] opacity-60"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-[var(--text-primary)]">{rule.label}</span>
            <Badge variant={SEVERITY_VARIANT[rule.severity]}>{rule.severity}</Badge>
            <Badge variant="outline">{CONDITION_LABELS[rule.conditionType]}</Badge>
            {rule.builtIn ? (
              <Badge variant="outline">Built-in</Badge>
            ) : (
              <Badge variant="info">Custom</Badge>
            )}
            {!rule.enabled && <Badge variant="outline">Disabled</Badge>}
          </div>
          <code className="inline-block text-xs text-[var(--text-faint)] font-mono">
            {rule.key}
          </code>
          {rule.description && (
            <p className="text-sm text-[var(--text-secondary)]">{rule.description}</p>
          )}
          <p className="text-xs text-[var(--text-muted)] font-mono">
            {summarizeConfig(rule)}
            {scope.length > 0 && ` · scope: ${scope.join("; ")}`}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <Button size="sm" variant="outline" onClick={onToggle} disabled={busy}>
            {rule.enabled ? "Disable" : "Enable"}
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit} disabled={busy} title="Edit">
            <Pencil className="h-3 w-3" />
          </Button>
          {rule.builtIn ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onReset}
              disabled={busy}
              title="Reset to default"
            >
              <RotateCcw className="h-3 w-3" />
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onDelete} disabled={busy} title="Delete">
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

const selectClass =
  "w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)]";

function NumberField({
  label,
  value,
  onChange,
  hint,
  step,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  hint?: string;
  step?: string;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input
        type="number"
        step={step}
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? undefined : Number(e.target.value))
        }
      />
      {hint && <p className="text-xs text-[var(--text-faint)]">{hint}</p>}
    </div>
  );
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ConditionFields({
  conditionType,
  config,
  setConfig,
}: {
  conditionType: ConditionType;
  config: RuleConfig;
  setConfig: (updater: (prev: RuleConfig) => RuleConfig) => void;
}) {
  const set = (patch: RuleConfig) => setConfig((prev) => ({ ...prev, ...patch }));
  const num = (field: string) =>
    typeof config[field] === "number" ? (config[field] as number) : undefined;

  const windowField = (
    <NumberField
      label="Window (hours)"
      value={num("windowHours")}
      onChange={(v) => set({ windowHours: v })}
      hint="168 = 7 days. Daily provider telemetry needs at least 24."
    />
  );

  const floors = (
    <div className="grid grid-cols-2 gap-3">
      <NumberField
        label="Min tokens (floor)"
        value={num("minTokens")}
        onChange={(v) => set({ minTokens: v })}
        hint="Suppresses low-volume noise. Optional."
      />
      <NumberField
        label="Min cost (floor)"
        value={num("minCost")}
        onChange={(v) => set({ minCost: v })}
        step="0.01"
        hint="Cleared if either floor is met."
      />
    </div>
  );

  switch (conditionType) {
    case "VOLUME_THRESHOLD":
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Metric</Label>
            <select
              className={selectClass}
              value={String(config.metric ?? "cost")}
              onChange={(e) => set({ metric: e.target.value })}
            >
              <option value="cost">cost</option>
              <option value="tokens">tokens</option>
              <option value="requests">requests</option>
            </select>
          </div>
          {windowField}
          <NumberField
            label="Threshold"
            value={num("threshold")}
            onChange={(v) => set({ threshold: v })}
            step="0.01"
            hint="Fires when the window total exceeds this."
          />
        </div>
      );

    case "SPIKE_MULTIPLIER":
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Metric</Label>
            <select
              className={selectClass}
              value={String(config.metric ?? "cost")}
              onChange={(e) => set({ metric: e.target.value })}
            >
              <option value="cost">cost</option>
              <option value="tokens">tokens</option>
              <option value="requests">requests</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {windowField}
            <NumberField
              label="Baseline (hours)"
              value={num("baselineHours")}
              onChange={(v) => set({ baselineHours: v })}
              hint="The window immediately before."
            />
          </div>
          <NumberField
            label="Multiplier"
            value={num("multiplier")}
            onChange={(v) => set({ multiplier: v })}
            step="0.1"
            hint="3 = recent is at least 3x the baseline. Minimum 1.1."
          />
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Min recent tokens"
              value={num("minRecentTokens")}
              onChange={(v) => set({ minRecentTokens: v })}
            />
            <NumberField
              label="Min recent cost"
              value={num("minRecentCost")}
              onChange={(v) => set({ minRecentCost: v })}
              step="0.01"
            />
          </div>
        </div>
      );

    case "NEW_KEY":
      return (
        <div className="space-y-3">
          {windowField}
          {floors}
        </div>
      );

    case "DORMANT_REACTIVATION":
      return (
        <div className="space-y-3">
          <NumberField
            label="Dormant for at least (days)"
            value={num("dormantDays")}
            onChange={(v) => set({ dormantDays: v })}
            hint="The idle gap required before the key woke up."
          />
          {windowField}
          {floors}
        </div>
      );

    case "OFF_HOURS":
      return (
        <div className="space-y-3">
          {windowField}
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Business hours start"
              value={num("businessHourStart")}
              onChange={(v) => set({ businessHourStart: v })}
              hint="0-23, inclusive."
            />
            <NumberField
              label="Business hours end"
              value={num("businessHourEnd")}
              onChange={(v) => set({ businessHourEnd: v })}
              hint="1-24, exclusive."
            />
          </div>
          <div className="space-y-1">
            <Label>Business days</Label>
            <div className="flex flex-wrap gap-2">
              {DAY_LABELS.map((day, index) => {
                const days = Array.isArray(config.businessDays)
                  ? (config.businessDays as number[])
                  : [];
                const active = days.includes(index);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() =>
                      set({
                        businessDays: active
                          ? days.filter((d) => d !== index)
                          : [...days, index].sort(),
                      })
                    }
                    className={`rounded-md border px-3 py-1 text-xs transition-colors ${
                      active
                        ? "border-[var(--accent)] bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                        : "border-[var(--border-subtle)] text-[var(--text-faint)]"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
          <NumberField
            label="Timezone offset (minutes from UTC)"
            value={num("timezoneOffsetMinutes")}
            onChange={(v) => set({ timezoneOffsetMinutes: v })}
            hint="0 = UTC, -300 = US Eastern (EST), -420 = US Pacific (PDT)."
          />
          {floors}
          <div className="flex gap-2 rounded-md border border-[var(--warning-border)] bg-[var(--warning-dim)] p-3">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-[var(--warning-strong)]" />
            <p className="text-xs text-[var(--warning-strong)]">
              This condition needs hourly telemetry. Provider Admin API sync reports
              daily totals only, so it evaluates proxy-ingested keys and stays silent
              on the rest rather than guessing.
            </p>
          </div>
        </div>
      );

    case "MODEL_ALLOWLIST": {
      const models = Array.isArray(config.allowedModels)
        ? (config.allowedModels as string[])
        : [];
      return (
        <div className="space-y-3">
          {windowField}
          <div className="space-y-1">
            <Label>Allowed models (one per line)</Label>
            <Textarea
              rows={4}
              value={models.join("\n")}
              onChange={(e) =>
                set({
                  allowedModels: e.target.value
                    .split("\n")
                    .map((m) => m.trim())
                    .filter(Boolean),
                })
              }
              placeholder={"claude-sonnet\nclaude-haiku\ngpt-5"}
            />
            <p className="text-xs text-[var(--text-faint)]">
              Case-insensitive substring match. An empty list leaves the rule inactive.
            </p>
          </div>
          {floors}
        </div>
      );
    }

    case "FAN_OUT":
      return (
        <div className="space-y-3">
          {windowField}
          <div className="space-y-1">
            <Label>Dimension</Label>
            <select
              className={selectClass}
              value={String(config.dimension ?? "project")}
              onChange={(e) => set({ dimension: e.target.value })}
            >
              <option value="project">project</option>
              <option value="actor">actor</option>
            </select>
          </div>
          <NumberField
            label="Max distinct"
            value={num("maxDistinct")}
            onChange={(v) => set({ maxDistinct: v })}
            hint="Fires above this count."
          />
        </div>
      );
  }
}

function RuleEditorDialog({
  open,
  rule,
  onClose,
  onSaved,
}: {
  open: boolean;
  rule: KeyUsageRule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isUpdate = rule !== null;
  const [key, setKey] = useState(rule?.key ?? "");
  const [label, setLabel] = useState(rule?.label ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [severity, setSeverity] = useState<Severity>(rule?.severity ?? "MEDIUM");
  const [conditionType, setConditionType] = useState<ConditionType>(
    rule?.conditionType ?? "VOLUME_THRESHOLD"
  );
  const [config, setConfig] = useState<RuleConfig>(
    rule?.config ?? defaultConfig("VOLUME_THRESHOLD")
  );
  const [providers, setProviders] = useState(rule?.providers.join(", ") ?? "");
  const [apiKeys, setApiKeys] = useState(rule?.apiKeyExternalIds.join(", ") ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    keysEvaluated: number;
    matchCount: number;
    matches: PreviewMatch[];
  } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const csvToArray = (value: string) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

  function changeCondition(next: ConditionType) {
    setConditionType(next);
    // Config shapes are disjoint, so carrying the old one over would fail
    // validation. Reset to that condition's defaults.
    setConfig(defaultConfig(next));
    setPreview(null);
  }

  async function runPreview() {
    setError(null);
    setPreviewing(true);
    setPreview(null);
    try {
      const res = await fetch("/api/key-usage-rules/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conditionType,
          config: { ...config, conditionType },
          providers: csvToArray(providers),
          apiKeyExternalIds: csvToArray(apiKeys),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Preview failed (${res.status})`);
        return;
      }
      setPreview(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const url = isUpdate ? `/api/key-usage-rules/${rule.id}` : "/api/key-usage-rules";
      const body = {
        ...(isUpdate ? {} : { key, conditionType }),
        label,
        description: description || null,
        severity,
        config: { ...config, conditionType },
        providers: csvToArray(providers),
        apiKeyExternalIds: csvToArray(apiKeys),
      };

      const res = await fetch(url, {
        method: isUpdate ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isUpdate ? `Edit ${rule.label}` : "New key usage rule"}</DialogTitle>
          <DialogDescription>
            Rules are evaluated hourly against per-key provider telemetry. Matches raise
            an alert — nothing is blocked.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!isUpdate && (
            <div className="space-y-1">
              <Label>Key</Label>
              <Input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="e.g. finance_key_spend_ceiling"
              />
              <p className="text-xs text-[var(--text-faint)]">
                Lowercase letters, digits, and underscores. Permanent once created — it
                is the dedupe identity on every alert this rule raises.
              </p>
            </div>
          )}

          <div className="space-y-1">
            <Label>Label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Short human-readable name"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Condition</Label>
              <select
                className={selectClass}
                value={conditionType}
                disabled={isUpdate}
                onChange={(e) => changeCondition(e.target.value as ConditionType)}
              >
                {CONDITION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {CONDITION_LABELS[type]}
                  </option>
                ))}
              </select>
              {isUpdate && (
                <p className="text-xs text-[var(--text-faint)]">
                  Immutable — create a new rule for a different condition.
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label>Alert severity</Label>
              <select
                className={selectClass}
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Severity)}
              >
                {SEVERITIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-xs text-[var(--text-secondary)]">
            {CONDITION_HELP[conditionType]}
          </p>

          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this rule catch? (optional)"
              rows={2}
            />
          </div>

          <div className="rounded-md border border-[var(--border-subtle)] p-4 space-y-3">
            <p className="text-sm font-medium text-[var(--text-primary)]">Condition settings</p>
            <ConditionFields
              conditionType={conditionType}
              config={config}
              setConfig={setConfig}
            />
          </div>

          <div className="rounded-md border border-[var(--border-subtle)] p-4 space-y-3">
            <p className="text-sm font-medium text-[var(--text-primary)]">Scope</p>
            <div className="space-y-1">
              <Label>Providers</Label>
              <Input
                value={providers}
                onChange={(e) => setProviders(e.target.value)}
                placeholder="anthropic, openai — leave blank for all"
              />
            </div>
            <div className="space-y-1">
              <Label>Specific API key IDs</Label>
              <Input
                value={apiKeys}
                onChange={(e) => setApiKeys(e.target.value)}
                placeholder="apikey_abc, apikey_def — leave blank for all keys"
              />
            </div>
          </div>

          {preview && (
            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 space-y-2">
              <p className="text-sm text-[var(--text-primary)]">
                {preview.matchCount} match{preview.matchCount === 1 ? "" : "es"} across{" "}
                {preview.keysEvaluated} key{preview.keysEvaluated === 1 ? "" : "s"} in the
                current telemetry window.
              </p>
              {preview.matchCount === 0 && (
                <p className="text-xs text-[var(--text-faint)]">
                  Nothing matches right now. That may be correct, or the thresholds may be
                  too high for your volume.
                </p>
              )}
              {preview.matches.map((match, index) => (
                <div key={index} className="text-xs text-[var(--text-secondary)]">
                  <span className="font-mono">
                    {match.provider} / {match.apiKeyName ?? match.apiKeyExternalId}
                  </span>
                  {match.reasons[0] && <span> — {match.reasons[0]}</span>}
                </div>
              ))}
              {preview.matchCount > preview.matches.length && (
                <p className="text-xs text-[var(--text-faint)]">
                  Showing the first {preview.matches.length}.
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="rounded-md border border-[var(--critical-border)] bg-[var(--critical-dim)] p-3 text-sm text-[var(--critical-strong)]">
              {error}
            </p>
          )}

          <div className="flex justify-between gap-2">
            <Button variant="outline" onClick={runPreview} disabled={previewing}>
              <Play className="h-3 w-3 mr-1" />
              {previewing ? "Testing…" : "Test against live data"}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving || !label.trim() || (!isUpdate && !key.trim())}>
                {saving ? "Saving…" : isUpdate ? "Save changes" : "Create rule"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
