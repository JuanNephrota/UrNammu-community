/**
 * Human-review triggers — the conditions under which an agent's tool call
 * must stop for a person.
 *
 * Pure logic shared (by copy) between the Next.js app and the Azure Functions
 * proxy; `ai-proxy/src/lib/human-review-triggers.ts` is a byte-identical
 * mirror (guarded by scripts/check-mirror-drift.mjs).
 *
 * `AIAgent.humanReviewTriggers` started life as free-form JSON ("amount >
 * 1000", "contains PII"). It now holds a list of structured triggers that
 * both proxies evaluate against the ARGUMENTS of every tool call the model
 * makes (`tool_use.input`, OpenAI `function.arguments`, `mcp_call.arguments`):
 *
 * - `tool`           any call of a tool (glob on "server/tool" or "tool")
 * - `tool_argument`  a JSON-path argument compared against a value
 * - `sensitive_data` the call's arguments contain sensitive data, as judged
 *                    by the proxy's existing detectors (categories optional)
 * - `note`           informational only; never evaluated (legacy free text
 *                    is normalised into notes so nothing is lost)
 *
 * `humanReviewEnforcement` decides what a match does: "monitor" records a
 * dry-run PolicyDenial and raises a HIGH alert; "enforce" withholds the model
 * response entirely and returns 403 `human_review_required`, which halts the
 * agent loop until a person acts (docs/plans/agentic-governance-playbook.md §3).
 */

import { toolLabel, type ObservedToolUse } from "./mcp-tool-governance";

export const HUMAN_REVIEW_RULE = "human_review_required";
export const HUMAN_REVIEW_ALERT_SOURCE = "human_review_trigger";

export type TriggerOp = "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "contains" | "matches" | "exists";
export const TRIGGER_OPS: readonly TriggerOp[] = ["gt", "gte", "lt", "lte", "eq", "neq", "contains", "matches", "exists"];

export type HumanReviewTrigger =
  | { kind: "tool"; tool: string; label?: string }
  | {
      kind: "tool_argument";
      tool: string;
      path: string;
      op: TriggerOp;
      value?: string | number | boolean;
      label?: string;
    }
  | { kind: "sensitive_data"; tool?: string; categories?: string[]; label?: string }
  | { kind: "note"; text: string };

export type HumanReviewEnforcement = "monitor" | "enforce";

export function normalizeReviewEnforcement(value: unknown): HumanReviewEnforcement {
  return value === "enforce" ? "enforce" : "monitor";
}

export function isEnforceableTrigger(trigger: HumanReviewTrigger): boolean {
  return trigger.kind !== "note";
}

// ─── Normalisation ─────────────────────────────────────────────────────────

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asScalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value;
  return undefined;
}

function noteOf(value: unknown): HumanReviewTrigger {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return { kind: "note", text: (text ?? "").slice(0, 500) };
}

function normalizeOne(raw: unknown): HumanReviewTrigger | null {
  if (raw == null) return null;
  if (typeof raw === "string") return raw.trim() ? noteOf(raw.trim()) : null;
  if (typeof raw !== "object" || Array.isArray(raw)) return noteOf(raw);
  const t = raw as Record<string, unknown>;
  const label = asString(t.label) ?? undefined;
  switch (t.kind) {
    case "tool": {
      const tool = asString(t.tool);
      return tool ? { kind: "tool", tool, ...(label ? { label } : {}) } : null;
    }
    case "tool_argument": {
      const tool = asString(t.tool) ?? "*";
      const path = asString(t.path);
      const op = TRIGGER_OPS.includes(t.op as TriggerOp) ? (t.op as TriggerOp) : null;
      if (!path || !op) return null;
      const value = op === "exists" ? undefined : asScalar(t.value);
      return {
        kind: "tool_argument",
        tool,
        path,
        op,
        ...(value !== undefined ? { value } : {}),
        ...(label ? { label } : {}),
      };
    }
    case "sensitive_data": {
      const tool = asString(t.tool) ?? undefined;
      const categories = Array.isArray(t.categories)
        ? t.categories.map((c) => asString(c)).filter((c): c is string => !!c)
        : [];
      return {
        kind: "sensitive_data",
        ...(tool ? { tool } : {}),
        ...(categories.length ? { categories } : {}),
        ...(label ? { label } : {}),
      };
    }
    case "note": {
      const text = asString(t.text) ?? asString(t.note);
      return text ? { kind: "note", text: text.slice(0, 500) } : null;
    }
    default: {
      const text = asString(t.text) ?? asString(t.note) ?? asString(t.description);
      return noteOf(text ?? raw);
    }
  }
}

/**
 * Coerce whatever is stored in `humanReviewTriggers` into a trigger list.
 * Legacy strings and unknown objects become notes; invalid structured entries
 * are dropped.
 */
export function normalizeHumanReviewTriggers(raw: unknown): HumanReviewTrigger[] {
  if (raw == null) return [];
  let value: unknown = raw;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        value = JSON.parse(trimmed);
      } catch {
        return [noteOf(trimmed)];
      }
    } else {
      return [noteOf(trimmed)];
    }
  }
  if (Array.isArray(value)) {
    return value.map(normalizeOne).filter((t): t is HumanReviewTrigger => t !== null).slice(0, 100);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.kind === "string") {
      const one = normalizeOne(obj);
      return one ? [one] : [];
    }
    return Object.entries(obj)
      .map(([k, v]) => noteOf(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`))
      .slice(0, 100);
  }
  return [noteOf(value)];
}

const OP_TEXT: Record<TriggerOp, string> = {
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  eq: "=",
  neq: "≠",
  contains: "contains",
  matches: "matches",
  exists: "is present",
};

/** Short human description, used as the default label. */
export function describeTrigger(trigger: HumanReviewTrigger): string {
  switch (trigger.kind) {
    case "tool":
      return `any call to ${trigger.tool}`;
    case "tool_argument":
      return trigger.op === "exists"
        ? `${trigger.tool}: ${trigger.path} ${OP_TEXT.exists}`
        : `${trigger.tool}: ${trigger.path} ${OP_TEXT[trigger.op]} ${String(trigger.value ?? "")}`.trim();
    case "sensitive_data":
      return `${trigger.tool ?? "any tool"}: arguments contain ${
        trigger.categories?.length ? trigger.categories.join("/") : "sensitive data"
      }`;
    case "note":
      return trigger.text;
  }
}

export function triggerLabel(trigger: HumanReviewTrigger): string {
  return (trigger.kind !== "note" && trigger.label) || describeTrigger(trigger);
}

// ─── Evaluation ────────────────────────────────────────────────────────────

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .toLowerCase()
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * `*` matches every tool; a pattern with a `/` is matched against
 * "server/tool"; a bare pattern matches the tool name on any server.
 */
export function toolMatches(pattern: string | undefined, use: { serverName: string | null; toolName: string }): boolean {
  const p = (pattern ?? "*").trim();
  if (!p || p === "*") return true;
  const re = globToRegex(p);
  if (p.includes("/")) return re.test(toolLabel(use).toLowerCase());
  return re.test(use.toolName.toLowerCase()) || re.test(toolLabel(use).toLowerCase());
}

/** Dot path into the tool arguments; numeric segments index arrays. */
export function getArgument(input: unknown, path: string): unknown {
  let current: unknown = input;
  for (const rawSegment of path.split(".")) {
    const segment = rawSegment.trim();
    if (!segment) continue;
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$€£,\s_]/g, "");
    if (!cleaned || !/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function safeRegex(source: string): RegExp | null {
  try {
    return new RegExp(source, "i");
  } catch {
    return null;
  }
}

export function compareArgument(op: TriggerOp, actual: unknown, expected: string | number | boolean | undefined): boolean {
  if (op === "exists") return actual !== undefined && actual !== null && actual !== "";
  if (actual === undefined || actual === null) return false;
  if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
    const a = toNumber(actual);
    const e = toNumber(expected);
    if (a === null || e === null) return false;
    return op === "gt" ? a > e : op === "gte" ? a >= e : op === "lt" ? a < e : a <= e;
  }
  if (op === "contains") {
    const needle = String(expected ?? "").toLowerCase();
    if (!needle) return false;
    if (Array.isArray(actual)) return actual.some((v) => String(v).toLowerCase() === needle || String(v).toLowerCase().includes(needle));
    return String(typeof actual === "object" ? JSON.stringify(actual) : actual).toLowerCase().includes(needle);
  }
  if (op === "matches") {
    const re = safeRegex(String(expected ?? ""));
    return re ? re.test(typeof actual === "object" ? JSON.stringify(actual) : String(actual)) : false;
  }
  // eq / neq
  const an = toNumber(actual);
  const en = toNumber(expected);
  const equal =
    an !== null && en !== null
      ? an === en
      : String(actual).trim().toLowerCase() === String(expected ?? "").trim().toLowerCase();
  return op === "eq" ? equal : !equal;
}

/** Short, sanitised rendering of an argument value for denials and alerts. */
export function excerptValue(value: unknown, max = 120): string {
  let text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  text = text.replace(/\d{6,}/g, (m) => `…${m.slice(-4)}`);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export type HumanReviewMatch = {
  trigger: HumanReviewTrigger;
  triggerLabel: string;
  use: ObservedToolUse;
  /** "server/tool" or "tool". */
  tool: string;
  /** What matched, e.g. `amount = 5000` or `categories: pii`. */
  detail: string;
};

export type EvaluateOptions = {
  /**
   * Sensitive-data categories detected in each use's arguments, parallel to
   * `uses`. Provided by the IO layer (the detectors are async); when absent,
   * `sensitive_data` triggers cannot match.
   */
  sensitiveCategories?: Array<string[] | null | undefined>;
};

export function hasSensitiveDataTriggers(triggers: HumanReviewTrigger[]): boolean {
  return triggers.some((t) => t.kind === "sensitive_data");
}

export function evaluateHumanReviewTriggers(
  triggers: HumanReviewTrigger[],
  uses: ObservedToolUse[],
  options: EvaluateOptions = {}
): HumanReviewMatch[] {
  const matches: HumanReviewMatch[] = [];
  const active = triggers.filter(isEnforceableTrigger);
  if (active.length === 0 || uses.length === 0) return matches;

  uses.forEach((use, index) => {
    const label = toolLabel(use);
    for (const trigger of active) {
      if (trigger.kind === "tool") {
        if (toolMatches(trigger.tool, use)) {
          matches.push({ trigger, triggerLabel: triggerLabel(trigger), use, tool: label, detail: "tool invoked" });
        }
        continue;
      }
      if (trigger.kind === "tool_argument") {
        if (!toolMatches(trigger.tool, use)) continue;
        const actual = getArgument(use.input, trigger.path);
        if (compareArgument(trigger.op, actual, trigger.value)) {
          matches.push({
            trigger,
            triggerLabel: triggerLabel(trigger),
            use,
            tool: label,
            detail: `${trigger.path} = ${excerptValue(actual)}`,
          });
        }
        continue;
      }
      if (trigger.kind === "sensitive_data") {
        if (!toolMatches(trigger.tool, use)) continue;
        const found = options.sensitiveCategories?.[index] ?? null;
        if (!found || found.length === 0) continue;
        const wanted = trigger.categories?.map((c) => c.toLowerCase()) ?? [];
        const hit = wanted.length === 0 ? found : found.filter((c) => wanted.includes(c.toLowerCase()));
        if (hit.length > 0) {
          matches.push({
            trigger,
            triggerLabel: triggerLabel(trigger),
            use,
            tool: label,
            detail: `arguments contain ${hit.join(", ")}`,
          });
        }
      }
    }
  });
  return matches;
}

/** Labels of the tools that matched, for flagging AgentToolCall rows. */
export function matchedToolLabels(matches: HumanReviewMatch[]): Set<string> {
  return new Set(matches.map((m) => m.tool));
}

/** `PolicyDenial.reasons[]` entries for a set of matches. */
export function humanReviewDenialReasons(agent: { id: string; name: string }, matches: HumanReviewMatch[]) {
  return matches.map((m) => ({
    ruleKey: HUMAN_REVIEW_RULE,
    message: `Agent "${agent.name}" called ${m.tool} (${m.detail}), matching human-review trigger "${m.triggerLabel}".`,
    policyId: agent.id,
    policyName: `Human review trigger: ${m.triggerLabel}`,
  }));
}

/** Compact per-match record for `PolicyDenial.requestMetadata` and alerts. */
export function summarizeMatches(matches: HumanReviewMatch[]) {
  return matches.slice(0, 20).map((m) => ({
    trigger: m.triggerLabel,
    kind: m.trigger.kind,
    tool: m.tool,
    detail: m.detail,
  }));
}

/**
 * The 403 body both proxies return in enforce mode. Same shape as the other
 * proxy refusals so clients that parse `violations` need no new handling.
 */
export function humanReviewBlockedBody(
  agent: { id: string; name: string },
  matches: HumanReviewMatch[],
  review?: { id: string; url: string | null } | null
) {
  const first = matches[0];
  const next = review
    ? ` Pending review ${review.id}${review.url ? ` (${review.url})` : ""}: once a reviewer approves it, re-run the call and the proxy will let it through.`
    : " A reviewer must act before the agent may continue.";
  return {
    error: {
      type: HUMAN_REVIEW_RULE,
      message: `Response withheld: agent "${agent.name}" attempted ${first?.tool ?? "a tool call"} that requires human review (${first?.triggerLabel ?? "trigger"}).${next}`,
      ...(review ? { review: { id: review.id, url: review.url, status: "PENDING" } } : {}),
      violations: matches.map((m) => ({
        rule: HUMAN_REVIEW_RULE,
        trigger: m.triggerLabel,
        tool: m.tool,
        detail: m.detail,
        policy: `Human review trigger: ${m.triggerLabel}`,
      })),
    },
  };
}
