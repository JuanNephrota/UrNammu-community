"use client";

import { useCallback, useMemo, useState } from "react";
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
import { HelpHint } from "@/components/help/help-hint";
import { Pencil, Plus, RotateCcw, Trash2, Play } from "lucide-react";

type Rule = {
  id: string;
  key: string;
  label: string;
  severity: string;
  patterns: string[];
  description: string | null;
  enabled: boolean;
  builtIn: boolean;
};

type FormState = {
  key: string;
  label: string;
  severity: "critical" | "warning";
  description: string;
  patterns: string[];
};

function emptyForm(): FormState {
  return {
    key: "",
    label: "",
    severity: "warning",
    description: "",
    patterns: [""],
  };
}

function formFromRule(rule: Rule): FormState {
  return {
    key: rule.key,
    label: rule.label,
    severity: rule.severity === "critical" ? "critical" : "warning",
    description: rule.description ?? "",
    patterns: rule.patterns.length > 0 ? [...rule.patterns] : [""],
  };
}

export function PromptRulesManager({ initialRules }: { initialRules: Rule[] }) {
  const router = useRouter();
  const [rules] = useState<Rule[]>(initialRules);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(() => router.refresh(), [router]);

  async function toggleEnabled(rule: Rule) {
    setBusyId(rule.id);
    try {
      await fetch(`/api/prompt-risk-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function deleteCustom(rule: Rule) {
    if (!confirm(`Delete custom rule "${rule.label}"? This cannot be undone.`)) return;
    setBusyId(rule.id);
    try {
      await fetch(`/api/prompt-risk-rules/${rule.id}`, { method: "DELETE" });
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function resetBuiltIn(rule: Rule) {
    if (
      !confirm(
        `Reset "${rule.label}" to its default label, severity, and patterns? Current edits will be discarded.`
      )
    )
      return;
    setBusyId(rule.id);
    try {
      await fetch(`/api/prompt-risk-rules/${rule.id}/reset`, { method: "POST" });
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <TestPanel />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Detection Rules ({rules.length})</CardTitle>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1" /> New custom rule
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {rules.map((rule) => (
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
          open={!!editingRule}
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
          open={creating}
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
  rule: Rule;
  busy: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onReset: () => void;
}) {
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
            <Badge variant={rule.severity === "critical" ? "critical" : "warning"}>
              {rule.severity}
            </Badge>
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
          <div className="flex flex-wrap gap-1">
            {rule.patterns.map((p, i) => (
              <code
                key={i}
                className="rounded bg-[var(--bg-base)] px-2 py-0.5 text-xs text-[var(--text-secondary)] border border-[var(--border-subtle)] font-mono max-w-full truncate"
                title={p}
              >
                {p}
              </code>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <Button size="sm" variant="outline" onClick={onToggle} disabled={busy}>
            {rule.enabled ? "Disable" : "Enable"}
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}>
            <Pencil className="h-3 w-3" />
          </Button>
          {rule.builtIn ? (
            <Button size="sm" variant="outline" onClick={onReset} disabled={busy} title="Reset to default">
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

function RuleEditorDialog({
  open,
  rule,
  onClose,
  onSaved,
}: {
  open: boolean;
  rule: Rule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(rule ? formFromRule(rule) : emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-pattern compile check (client-side hint; server does the authoritative
  // check including ReDoS rules).
  const patternErrors = useMemo(() => {
    return form.patterns.map((p) => {
      if (!p.trim()) return "Empty pattern";
      try {
        new RegExp(p, "i");
        return null;
      } catch (err) {
        return (err as Error).message;
      }
    });
  }, [form.patterns]);

  const hasErrors = patternErrors.some(Boolean);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const cleanPatterns = form.patterns.map((p) => p.trim()).filter(Boolean);
      if (cleanPatterns.length === 0) {
        setError("At least one pattern is required.");
        setSaving(false);
        return;
      }

      const isUpdate = rule !== null;
      const url = isUpdate ? `/api/prompt-risk-rules/${rule!.id}` : "/api/prompt-risk-rules";
      const method = isUpdate ? "PATCH" : "POST";

      const body = isUpdate
        ? {
            label: form.label,
            severity: form.severity,
            patterns: cleanPatterns,
            description: form.description || null,
          }
        : {
            key: form.key,
            label: form.label,
            severity: form.severity,
            patterns: cleanPatterns,
            description: form.description || null,
          };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Request failed (${res.status})`);
        setSaving(false);
        return;
      }

      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function updatePattern(i: number, value: string) {
    setForm((f) => ({
      ...f,
      patterns: f.patterns.map((p, idx) => (idx === i ? value : p)),
    }));
  }

  function addPattern() {
    if (form.patterns.length >= 10) return;
    setForm((f) => ({ ...f, patterns: [...f.patterns, ""] }));
  }

  function removePattern(i: number) {
    setForm((f) => ({
      ...f,
      patterns: f.patterns.filter((_, idx) => idx !== i),
    }));
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {rule ? `Edit: ${rule.label}` : "New custom rule"}
          </DialogTitle>
          <DialogDescription>
            {rule?.builtIn
              ? "Built-in rule. Key is locked; use Reset to restore the default definition."
              : "Regex patterns are matched case-insensitively against user-authored prompt text only."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!rule && (
            <div className="space-y-1">
              <Label className="flex items-center gap-2">
                Key <HelpHint hint="prompt_risk_rule_key" />
              </Label>
              <Input
                value={form.key}
                onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
                placeholder="e.g. custom_secrets"
              />
            </div>
          )}

          <div className="space-y-1">
            <Label>Label</Label>
            <Input
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="Short human-readable name"
            />
          </div>

          <div className="space-y-1">
            <Label className="flex items-center gap-2">
              Severity <HelpHint hint="prompt_risk_rule_severity" />
            </Label>
            <select
              value={form.severity}
              onChange={(e) =>
                setForm((f) => ({ ...f, severity: e.target.value as "critical" | "warning" }))
              }
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value="warning">warning (HIGH alert)</option>
              <option value="critical">critical (CRITICAL alert)</option>
            </select>
          </div>

          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What does this rule catch? (optional)"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              Regex patterns <HelpHint hint="prompt_risk_rule_patterns" />
            </Label>
            {form.patterns.map((p, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Input
                    value={p}
                    onChange={(e) => updatePattern(i, e.target.value)}
                    placeholder="\b(regex source)\b"
                    className="font-mono text-xs"
                  />
                  {form.patterns.length > 1 && (
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      onClick={() => removePattern(i)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                {patternErrors[i] && p.trim() && (
                  <p className="text-xs text-[var(--accent-danger,#f87171)]">
                    {patternErrors[i]}
                  </p>
                )}
              </div>
            ))}
            {form.patterns.length < 10 && (
              <Button size="sm" variant="outline" type="button" onClick={addPattern}>
                <Plus className="h-3 w-3 mr-1" /> Add pattern
              </Button>
            )}
          </div>

          {error && (
            <div className="rounded border border-[var(--accent-danger,#f87171)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--accent-danger,#f87171)]">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || hasErrors}>
            {saving ? "Saving..." : rule ? "Save changes" : "Create rule"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type TestResult = {
  flagged: boolean;
  severity: string | null;
  categories: string[];
  ruleKeys: string[];
  matchedSignals: string[];
  excerpt: string | null;
};

function TestPanel() {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!prompt.trim()) return;
    setError(null);
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch("/api/prompt-risk-rules/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setResult(await res.json());
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Play className="h-4 w-4" /> Test a prompt
          <HelpHint hint="prompt_risk_rule_test" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Paste a prompt to dry-run it against the current enabled rules (no alert is created)..."
          rows={3}
          className="font-mono text-sm"
        />
        <div className="flex justify-end">
          <Button onClick={run} disabled={testing || !prompt.trim()}>
            {testing ? "Testing..." : "Test"}
          </Button>
        </div>
        {error && (
          <div className="text-sm text-[var(--accent-danger,#f87171)]">{error}</div>
        )}
        {result && (
          <div className="space-y-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
            <div className="flex items-center gap-2">
              {result.flagged ? (
                <>
                  <Badge variant={result.severity === "critical" ? "critical" : "warning"}>
                    {result.severity}
                  </Badge>
                  <span className="text-sm font-medium">Would fire an alert</span>
                </>
              ) : (
                <>
                  <Badge variant="outline">Clean</Badge>
                  <span className="text-sm text-[var(--text-secondary)]">No rules matched</span>
                </>
              )}
            </div>
            {result.flagged && (
              <>
                <div>
                  <p className="text-xs text-[var(--text-faint)] mb-1">Rules matched:</p>
                  <div className="flex flex-wrap gap-1">
                    {result.ruleKeys.map((k) => (
                      <code
                        key={k}
                        className="rounded bg-[var(--bg-surface)] px-2 py-0.5 text-xs font-mono"
                      >
                        {k}
                      </code>
                    ))}
                  </div>
                </div>
                {result.matchedSignals.length > 0 && (
                  <div>
                    <p className="text-xs text-[var(--text-faint)] mb-1">Matched signals:</p>
                    <div className="flex flex-wrap gap-1">
                      {result.matchedSignals.map((s, i) => (
                        <code
                          key={i}
                          className="rounded bg-[var(--bg-surface)] px-2 py-0.5 text-xs"
                        >
                          {s}
                        </code>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
