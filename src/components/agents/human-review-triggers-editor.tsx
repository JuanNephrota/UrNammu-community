"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HelpHint } from "@/components/help/help-hint";
import {
  TRIGGER_OPS,
  describeTrigger,
  type HumanReviewTrigger,
  type TriggerOp,
} from "@/lib/human-review-triggers";

const KIND_LABELS: Record<HumanReviewTrigger["kind"], string> = {
  tool: "Any call of a tool",
  tool_argument: "Argument condition",
  sensitive_data: "Sensitive data in arguments",
  note: "Note (not evaluated)",
};

const OP_LABELS: Record<TriggerOp, string> = {
  gt: "greater than",
  gte: "at least",
  lt: "less than",
  lte: "at most",
  eq: "equals",
  neq: "does not equal",
  contains: "contains",
  matches: "matches regex",
  exists: "is present",
};

const selectClass =
  "flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none";

function blank(kind: HumanReviewTrigger["kind"]): HumanReviewTrigger {
  switch (kind) {
    case "tool":
      return { kind, tool: "" };
    case "tool_argument":
      return { kind, tool: "*", path: "", op: "gt", value: "" };
    case "sensitive_data":
      return { kind, tool: "*" };
    case "note":
      return { kind, text: "" };
  }
}

/**
 * Row editor for an agent's human-review triggers. Emits the structured list
 * the proxies evaluate; the parent form submits it as `humanReviewTriggers`.
 */
export function HumanReviewTriggersEditor({
  value,
  onChange,
  enforcement,
  onEnforcementChange,
}: {
  value: HumanReviewTrigger[];
  onChange: (next: HumanReviewTrigger[]) => void;
  enforcement: "monitor" | "enforce";
  onEnforcementChange: (next: "monitor" | "enforce") => void;
}) {
  const update = (index: number, next: HumanReviewTrigger) =>
    onChange(value.map((t, i) => (i === index ? next : t)));
  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5">
          Enforcement
          <HelpHint hint="human_review_enforcement" />
        </Label>
        <select
          name="humanReviewEnforcement"
          value={enforcement}
          onChange={(e) => onEnforcementChange(e.target.value === "enforce" ? "enforce" : "monitor")}
          className={selectClass}
        >
          <option value="monitor">Monitor — record a denial and alert, forward the response</option>
          <option value="enforce">Enforce — withhold the response (403), halt the agent until a person acts</option>
        </select>
        {enforcement === "enforce" && (
          <p className="text-xs text-[var(--text-muted)]">
            Streaming responses are buffered until the model finishes so the arguments can be checked; the
            client sees the full response only if no trigger matched.
          </p>
        )}
      </div>

      <div className="space-y-3">
        {value.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">
            No triggers yet. Add the tool calls or argument thresholds that must stop for a person.
          </p>
        )}
        {value.map((trigger, index) => (
          <div
            key={index}
            className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={trigger.kind}
                onChange={(e) => update(index, blank(e.target.value as HumanReviewTrigger["kind"]))}
                className={`${selectClass} sm:max-w-xs`}
                aria-label="Trigger kind"
              >
                {(Object.keys(KIND_LABELS) as HumanReviewTrigger["kind"][]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
              <span className="flex-1 truncate text-xs text-[var(--text-faint)]">{describeTrigger(trigger)}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)} aria-label="Remove trigger">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {trigger.kind === "note" && (
              <Input
                value={trigger.text}
                onChange={(e) => update(index, { ...trigger, text: e.target.value })}
                placeholder="Free-text guidance for reviewers (not evaluated by the proxy)"
              />
            )}

            {trigger.kind === "tool" && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  value={trigger.tool}
                  onChange={(e) => update(index, { ...trigger, tool: e.target.value })}
                  placeholder="tool, server/tool, server/* or delete_*"
                  aria-label="Tool pattern"
                />
                <Input
                  value={trigger.label ?? ""}
                  onChange={(e) => update(index, { ...trigger, label: e.target.value || undefined })}
                  placeholder="Label (optional)"
                  aria-label="Label"
                />
              </div>
            )}

            {trigger.kind === "tool_argument" && (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <Input
                  value={trigger.tool}
                  onChange={(e) => update(index, { ...trigger, tool: e.target.value })}
                  placeholder="tool pattern (* = any)"
                  aria-label="Tool pattern"
                />
                <Input
                  value={trigger.path}
                  onChange={(e) => update(index, { ...trigger, path: e.target.value })}
                  placeholder="argument path, e.g. amount or payment.total"
                  aria-label="Argument path"
                />
                <select
                  value={trigger.op}
                  onChange={(e) => update(index, { ...trigger, op: e.target.value as TriggerOp })}
                  className={selectClass}
                  aria-label="Operator"
                >
                  {TRIGGER_OPS.map((op) => (
                    <option key={op} value={op}>
                      {OP_LABELS[op]}
                    </option>
                  ))}
                </select>
                <Input
                  value={trigger.op === "exists" ? "" : String(trigger.value ?? "")}
                  disabled={trigger.op === "exists"}
                  onChange={(e) => update(index, { ...trigger, value: e.target.value })}
                  placeholder={trigger.op === "exists" ? "—" : "value, e.g. 1000"}
                  aria-label="Value"
                />
                <Input
                  value={trigger.label ?? ""}
                  onChange={(e) => update(index, { ...trigger, label: e.target.value || undefined })}
                  placeholder="Label (optional)"
                  aria-label="Label"
                />
              </div>
            )}

            {trigger.kind === "sensitive_data" && (
              <div className="grid gap-2 sm:grid-cols-3">
                <Input
                  value={trigger.tool ?? "*"}
                  onChange={(e) => update(index, { ...trigger, tool: e.target.value || undefined })}
                  placeholder="tool pattern (* = any)"
                  aria-label="Tool pattern"
                />
                <Input
                  value={(trigger.categories ?? []).join(", ")}
                  onChange={(e) =>
                    update(index, {
                      ...trigger,
                      categories: e.target.value
                        .split(",")
                        .map((c) => c.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="categories, e.g. pii, credentials (blank = any)"
                  aria-label="Categories"
                />
                <Input
                  value={trigger.label ?? ""}
                  onChange={(e) => update(index, { ...trigger, label: e.target.value || undefined })}
                  placeholder="Label (optional)"
                  aria-label="Label"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {(["tool_argument", "tool", "sensitive_data", "note"] as const).map((kind) => (
          <Button key={kind} type="button" variant="outline" size="sm" onClick={() => onChange([...value, blank(kind)])}>
            <Plus className="mr-1 h-3.5 w-3.5" /> {KIND_LABELS[kind]}
          </Button>
        ))}
      </div>
    </div>
  );
}
