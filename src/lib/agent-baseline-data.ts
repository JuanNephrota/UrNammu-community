/**
 * Data layer for agent behavioural baselines: reads the proxies' telemetry
 * for every attributed agent, computes/evaluates with `agent-baseline.ts`,
 * stores `AgentBehaviorBaseline`, and raises drift alerts.
 *
 * Runs daily from /api/cron/agent-baselines and on demand per agent. The
 * usage-log query is a single pass over the trailing window grouped by
 * `promptMetadata->>'agentId'`; there is no index on that expression, so it
 * is deliberately once a day rather than hourly.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  computeBaseline,
  emptyDay,
  evaluateDrift,
  mergeDailyActivity,
  type AgentBaselineStats,
  type DailyActivity,
  type DriftFinding,
} from "./agent-baseline";

export const AGENT_DRIFT_ALERT_SOURCE = "agent_behavior_drift";
export const BASELINE_WINDOW_DAYS = 28;
const DAY_MS = 24 * 60 * 60 * 1000;
const ALERT_DEDUPE_MS = DAY_MS;

// `day` is text (YYYY-MM-DD) and hours are taken straight from the stored
// value: Prisma's DateTime is `timestamp(3)` WITHOUT time zone holding UTC, so
// any `AT TIME ZONE` or Date-typed round trip would re-interpret it in the DB
// session's zone (not UTC on a developer machine).
type UsageRow = { agent_id: string; day: string; requests: number; models: string[]; hours: number[] };
type ToolRow = {
  agent_id: string;
  day: string;
  tool_calls: number;
  denied: number;
  review_required: number;
  tools: string[];
  users: string[];
  models: string[];
  hours: number[];
};

/** ISO instant as a zone-less literal so it compares against the stored UTC value as-is. */
const ts = (d: Date) => Prisma.sql`${d.toISOString()}::timestamp`;

/** Per-agent, per-UTC-day activity in [since, until). */
export async function loadDailyActivity(since: Date, until: Date): Promise<Map<string, DailyActivity[]>> {
  const [usage, tools] = await Promise.all([
    prisma.$queryRaw<UsageRow[]>(Prisma.sql`
      SELECT "promptMetadata"->>'agentId' AS agent_id,
             to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
             count(*)::int AS requests,
             array_remove(array_agg(DISTINCT model), NULL) AS models,
             array_agg(DISTINCT extract(hour FROM "createdAt")::int) AS hours
      FROM "APIUsageLog"
      WHERE "createdAt" >= ${ts(since)} AND "createdAt" < ${ts(until)}
        AND "promptMetadata"->>'agentId' IS NOT NULL
      GROUP BY 1, 2
    `),
    prisma.$queryRaw<ToolRow[]>(Prisma.sql`
      SELECT "agentId" AS agent_id,
             to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
             count(*)::int AS tool_calls,
             sum(CASE WHEN approved THEN 0 ELSE 1 END)::int AS denied,
             sum(CASE WHEN "reviewRequired" THEN 1 ELSE 0 END)::int AS review_required,
             array_agg(DISTINCT CASE WHEN "serverName" IS NULL THEN "toolName" ELSE "serverName" || '/' || "toolName" END) AS tools,
             array_remove(array_agg(DISTINCT "userEmail"), NULL) AS users,
             array_remove(array_agg(DISTINCT model), NULL) AS models,
             array_agg(DISTINCT extract(hour FROM "createdAt")::int) AS hours
      FROM "AgentToolCall"
      WHERE "agentId" IS NOT NULL AND "createdAt" >= ${ts(since)} AND "createdAt" < ${ts(until)}
      GROUP BY 1, 2
    `),
  ]);

  const byAgent = new Map<string, Map<string, DailyActivity>>();
  const dayOf = (agentId: string, key: string) => {
    const days = byAgent.get(agentId) ?? new Map<string, DailyActivity>();
    byAgent.set(agentId, days);
    const row = days.get(key) ?? emptyDay(key);
    days.set(key, row);
    return { days, key, row };
  };
  for (const u of usage) {
    const { days, key, row } = dayOf(u.agent_id, u.day);
    days.set(key, mergeDailyActivity(row, { requests: Number(u.requests), models: u.models ?? [], hours: u.hours ?? [] }));
  }
  for (const t of tools) {
    const { days, key, row } = dayOf(t.agent_id, t.day);
    days.set(
      key,
      mergeDailyActivity(row, {
        toolCalls: Number(t.tool_calls),
        denied: Number(t.denied),
        reviewRequired: Number(t.review_required),
        tools: t.tools ?? [],
        users: t.users ?? [],
        models: t.models ?? [],
        hours: t.hours ?? [],
      })
    );
  }
  const out = new Map<string, DailyActivity[]>();
  for (const [agentId, days] of byAgent) {
    out.set(agentId, [...days.values()].sort((a, b) => a.day.localeCompare(b.day)));
  }
  return out;
}

function foldRecent(days: DailyActivity[] | undefined): DailyActivity {
  return (days ?? []).reduce((acc, d) => mergeDailyActivity(acc, d), emptyDay("recent"));
}

async function upsertDriftAlert(input: { agentName: string; aiSystemId: string | null; finding: DriftFinding }) {
  const title = `${input.finding.title}: ${input.agentName}`;
  const description = `${input.finding.detail} Compare with the baseline on the agent page; if this is expected, recompute the baseline after the new pattern has settled, otherwise review the agent's recent tool calls and consider suspending it.`;
  const recent = await prisma.alert.findFirst({
    where: {
      source: AGENT_DRIFT_ALERT_SOURCE,
      title,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
      createdAt: { gte: new Date(Date.now() - ALERT_DEDUPE_MS) },
    },
    select: { id: true },
  });
  if (recent) {
    await prisma.alert.update({ where: { id: recent.id }, data: { description, severity: input.finding.severity } });
    return false;
  }
  await prisma.alert.create({
    data: { title, description, severity: input.finding.severity, source: AGENT_DRIFT_ALERT_SOURCE, aiSystemId: input.aiSystemId },
  });
  return true;
}

export type BaselineRunResult = {
  ok: boolean;
  agentsWithData: number;
  mature: number;
  findings: number;
  alertsCreated: number;
  errors: string[];
};

async function evaluateAgent(
  agent: { id: string; name: string; aiSystemId: string | null },
  history: DailyActivity[],
  recent: DailyActivity,
  now: Date
): Promise<{ stats: AgentBaselineStats; findings: DriftFinding[]; alertsCreated: number }> {
  const stats = computeBaseline(history, BASELINE_WINDOW_DAYS);
  const findings = evaluateDrift(stats, recent);
  await prisma.agentBehaviorBaseline.upsert({
    where: { agentId: agent.id },
    update: {
      windowDays: BASELINE_WINDOW_DAYS,
      activeDays: stats.activeDays,
      computedAt: now,
      stats: stats as unknown as Prisma.InputJsonValue,
      lastEvaluatedAt: now,
      lastFindings: findings as unknown as Prisma.InputJsonValue,
    },
    create: {
      agentId: agent.id,
      windowDays: BASELINE_WINDOW_DAYS,
      activeDays: stats.activeDays,
      computedAt: now,
      stats: stats as unknown as Prisma.InputJsonValue,
      lastEvaluatedAt: now,
      lastFindings: findings as unknown as Prisma.InputJsonValue,
    },
  });
  let alertsCreated = 0;
  for (const finding of findings) {
    if (await upsertDriftAlert({ agentName: agent.name, aiSystemId: agent.aiSystemId, finding })) alertsCreated += 1;
  }
  return { stats, findings, alertsCreated };
}

/** Baseline = the 28 days before the last 24 hours; the last 24 hours are what gets judged. */
function windows(now: Date) {
  const recentStart = new Date(now.getTime() - DAY_MS);
  const historyStart = new Date(recentStart.getTime() - BASELINE_WINDOW_DAYS * DAY_MS);
  return { historyStart, recentStart };
}

export async function runAgentBaselines(now = new Date()): Promise<BaselineRunResult> {
  const result: BaselineRunResult = { ok: true, agentsWithData: 0, mature: 0, findings: 0, alertsCreated: 0, errors: [] };
  try {
    const { historyStart, recentStart } = windows(now);
    const [history, recent, agents] = await Promise.all([
      loadDailyActivity(historyStart, recentStart),
      loadDailyActivity(recentStart, now),
      prisma.aIAgent.findMany({ where: { status: { not: "RETIRED" } }, select: { id: true, name: true, aiSystemId: true } }),
    ]);
    for (const agent of agents) {
      const days = history.get(agent.id) ?? [];
      const recentDays = recent.get(agent.id);
      if (days.length === 0 && !recentDays) continue;
      result.agentsWithData += 1;
      try {
        const { stats, findings, alertsCreated } = await evaluateAgent(agent, days, foldRecent(recentDays), now);
        if (stats.activeDays >= 7) result.mature += 1;
        result.findings += findings.length;
        result.alertsCreated += alertsCreated;
      } catch (err) {
        result.ok = false;
        result.errors.push(`${agent.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    result.ok = false;
    result.errors.push(err instanceof Error ? err.message : String(err));
  }
  return result;
}

export async function recomputeAgentBaseline(agentId: string, now = new Date()) {
  const agent = await prisma.aIAgent.findUnique({ where: { id: agentId }, select: { id: true, name: true, aiSystemId: true } });
  if (!agent) return null;
  const { historyStart, recentStart } = windows(now);
  const [history, recent] = await Promise.all([
    loadDailyActivity(historyStart, recentStart),
    loadDailyActivity(recentStart, now),
  ]);
  return evaluateAgent(agent, history.get(agent.id) ?? [], foldRecent(recent.get(agent.id)), now);
}
