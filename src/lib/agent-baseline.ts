/**
 * Agent behavioural baselines and drift detection. Pure: the data layer in
 * `agent-baseline-data.ts` turns proxy telemetry into `DailyActivity` rows,
 * this module turns those into a baseline and compares a recent window
 * against it (docs/plans/agentic-governance-playbook.md §5, "abnormal
 * pattern identification").
 *
 * Signals come from what the proxies already record for an agent: requests
 * (APIUsageLog attributed via x-agent-id), tool calls (AgentToolCall), the
 * models and tools used, the people calling it, the hours it is active, and
 * how often its tool calls fell outside the allowlist or matched a
 * human-review trigger.
 */

export type DailyActivity = {
  /** UTC calendar day, YYYY-MM-DD. */
  day: string;
  requests: number;
  toolCalls: number;
  /** Tool calls outside the allowlist. */
  denied: number;
  /** Tool calls that matched a human-review trigger. */
  reviewRequired: number;
  models: string[];
  tools: string[];
  users: string[];
  /** UTC hours (0–23) with any activity. */
  hours: number[];
};

export type Distribution = { mean: number; stddev: number; max: number };

export type AgentBaselineStats = {
  windowDays: number;
  activeDays: number;
  totalRequests: number;
  totalToolCalls: number;
  requestsPerDay: Distribution;
  toolCallsPerDay: Distribution;
  /** denied / toolCalls over the window (0 when no tool calls). */
  denialRate: number;
  reviewRate: number;
  models: string[];
  tools: string[];
  users: string[];
  /** UTC hours with activity on at least one day, ascending. */
  activeHours: number[];
};

export type DriftKind =
  | "volume_spike"
  | "tool_call_spike"
  | "denial_rate"
  | "new_model"
  | "new_user"
  | "off_hours";

export type DriftFinding = {
  kind: DriftKind;
  severity: "HIGH" | "MEDIUM";
  title: string;
  detail: string;
};

/** Days of activity a baseline needs before drift is reported. */
export const MIN_BASELINE_ACTIVE_DAYS = 7;

const EMPTY_DIST: Distribution = { mean: 0, stddev: 0, max: 0 };

export function distribution(values: number[]): Distribution {
  if (values.length === 0) return EMPTY_DIST;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, stddev: Math.sqrt(variance), max: Math.max(...values) };
}

const uniq = (values: string[]) => [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort();

/**
 * Baseline over the trailing window. Per-day distributions use only ACTIVE
 * days (days with any requests or tool calls), so an agent that runs on
 * weekdays is not compared against its own weekends.
 */
export function computeBaseline(days: DailyActivity[], windowDays: number): AgentBaselineStats {
  const active = days.filter((d) => d.requests > 0 || d.toolCalls > 0);
  const totalToolCalls = active.reduce((a, d) => a + d.toolCalls, 0);
  const denied = active.reduce((a, d) => a + d.denied, 0);
  const review = active.reduce((a, d) => a + d.reviewRequired, 0);
  return {
    windowDays,
    activeDays: active.length,
    totalRequests: active.reduce((a, d) => a + d.requests, 0),
    totalToolCalls,
    requestsPerDay: distribution(active.map((d) => d.requests)),
    toolCallsPerDay: distribution(active.map((d) => d.toolCalls)),
    denialRate: totalToolCalls > 0 ? denied / totalToolCalls : 0,
    reviewRate: totalToolCalls > 0 ? review / totalToolCalls : 0,
    models: uniq(active.flatMap((d) => d.models)),
    tools: uniq(active.flatMap((d) => d.tools)),
    users: uniq(active.flatMap((d) => d.users)),
    activeHours: [...new Set(active.flatMap((d) => d.hours))].filter((h) => h >= 0 && h <= 23).sort((a, b) => a - b),
  };
}

export function isBaselineMature(stats: AgentBaselineStats): boolean {
  return stats.activeDays >= MIN_BASELINE_ACTIVE_DAYS;
}

const fmtHour = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * Compare a recent window (normally the last 24 hours) against the baseline.
 * Returns nothing for an immature baseline: a week of history is the minimum
 * before "unusual" means anything.
 */
export function evaluateDrift(stats: AgentBaselineStats, recent: DailyActivity): DriftFinding[] {
  if (!isBaselineMature(stats)) return [];
  const findings: DriftFinding[] = [];

  const spike = (dist: Distribution, observed: number) =>
    observed > dist.mean + 3 * dist.stddev && observed >= Math.max(10, 2 * dist.mean);

  if (spike(stats.requestsPerDay, recent.requests)) {
    findings.push({
      kind: "volume_spike",
      severity: "HIGH",
      title: "Request volume spike",
      detail: `${recent.requests} requests in the last 24h against a baseline of ${stats.requestsPerDay.mean.toFixed(1)}/day (max ${stats.requestsPerDay.max}).`,
    });
  }
  if (spike(stats.toolCallsPerDay, recent.toolCalls)) {
    findings.push({
      kind: "tool_call_spike",
      severity: "HIGH",
      title: "Tool-call volume spike",
      detail: `${recent.toolCalls} tool calls in the last 24h against a baseline of ${stats.toolCallsPerDay.mean.toFixed(1)}/day (max ${stats.toolCallsPerDay.max}).`,
    });
  }
  if (recent.toolCalls > 0 && recent.denied >= 5) {
    const rate = recent.denied / recent.toolCalls;
    if (rate > stats.denialRate + 0.2) {
      findings.push({
        kind: "denial_rate",
        severity: "HIGH",
        title: "Allowlist denial rate jumped",
        detail: `${recent.denied} of ${recent.toolCalls} tool calls (${Math.round(rate * 100)}%) fell outside the allowlist, against a baseline of ${Math.round(stats.denialRate * 100)}%.`,
      });
    }
  }
  const newModels = uniq(recent.models).filter((m) => !stats.models.includes(m));
  if (stats.models.length > 0 && newModels.length > 0) {
    findings.push({
      kind: "new_model",
      severity: "MEDIUM",
      title: "New model in use",
      detail: `First use of ${newModels.join(", ")}; the baseline only saw ${stats.models.join(", ")}.`,
    });
  }
  const newUsers = uniq(recent.users).filter((u) => !stats.users.includes(u));
  if (stats.users.length > 0 && newUsers.length > 0) {
    findings.push({
      kind: "new_user",
      severity: "MEDIUM",
      title: "New caller",
      detail: `${newUsers.length} identit${newUsers.length === 1 ? "y" : "ies"} not seen in the baseline drove the agent: ${newUsers.slice(0, 5).join(", ")}${newUsers.length > 5 ? "…" : ""}.`,
    });
  }
  // Only meaningful when the agent has a recognisable schedule.
  if (stats.activeHours.length >= 1 && stats.activeHours.length <= 18) {
    const offHours = recent.hours.filter((h) => !stats.activeHours.includes(h)).sort((a, b) => a - b);
    if (offHours.length > 0) {
      findings.push({
        kind: "off_hours",
        severity: "MEDIUM",
        title: "Activity outside usual hours",
        detail: `Active at ${offHours.map(fmtHour).join(", ")} UTC; the baseline only shows activity between ${fmtHour(stats.activeHours[0])} and ${fmtHour(stats.activeHours[stats.activeHours.length - 1])} UTC.`,
      });
    }
  }
  return findings;
}

/** Merge two activity rows for the same day (requests from usage logs, tool calls from tool-call rows). */
export function mergeDailyActivity(a: DailyActivity, b: Partial<DailyActivity>): DailyActivity {
  return {
    day: a.day,
    requests: a.requests + (b.requests ?? 0),
    toolCalls: a.toolCalls + (b.toolCalls ?? 0),
    denied: a.denied + (b.denied ?? 0),
    reviewRequired: a.reviewRequired + (b.reviewRequired ?? 0),
    models: uniq([...a.models, ...(b.models ?? [])]),
    tools: uniq([...a.tools, ...(b.tools ?? [])]),
    users: uniq([...a.users, ...(b.users ?? [])]),
    hours: [...new Set([...a.hours, ...(b.hours ?? [])])].sort((x, y) => x - y),
  };
}

export function emptyDay(day: string): DailyActivity {
  return { day, requests: 0, toolCalls: 0, denied: 0, reviewRequired: 0, models: [], tools: [], users: [], hours: [] };
}
