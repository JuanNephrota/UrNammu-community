import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  type ClaudeCodeEventRow,
  CLAUDE_CODE_EVENT_SELECT,
} from "@/lib/claude-code-events";

// Shared data layer for the Claude Code analytics view (the OTel-sourced
// dashboard). Every loader takes an optional `userEmail` and `surface`
// (app.entrypoint, e.g. "local-agent" for Cowork) so the same view can be
// rendered all-up, per-user, or scoped to a single surface (the dedicated
// Cowork dashboard).

export function getSevenDaysAgo(): Date {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}
function getSixtyMinutesAgo(): Date {
  return new Date(Date.now() - 60 * 60 * 1000);
}

export const UNATTRIBUTED = "(unattributed)";
export const RECENT_EVENTS_LIMIT = 100;

// ── Shared SQL fragments ─────────────────────────────────────────────────
function userClause(userEmail?: string | null) {
  return userEmail ? Prisma.sql`AND "userEmail" = ${userEmail}` : Prisma.empty;
}
// Metrics carry the surface in the attributes JSON (app.entrypoint).
function metricSurfaceClause(surface?: string | null) {
  return surface
    ? Prisma.sql`AND attributes->>'app.entrypoint' = ${surface}`
    : Prisma.empty;
}
// Events carry it in a dedicated column.
function eventSurfaceClause(surface?: string | null) {
  return surface ? Prisma.sql`AND entrypoint = ${surface}` : Prisma.empty;
}

// ── Live telemetry (last 60m) ────────────────────────────────────────────
export interface LiveSummary {
  dataPoints: number;
  activeSessions: number;
  activeUsers: number;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  latestReceivedAt: Date | null;
}

export async function loadLiveTelemetry(
  userEmail?: string | null,
  surface?: string | null,
): Promise<LiveSummary> {
  const rows = await prisma.claudeCodeMetric.findMany({
    where: {
      timestamp: { gte: getSixtyMinutesAgo() },
      ...(userEmail ? { userEmail } : {}),
      ...(surface
        ? { attributes: { path: ["app.entrypoint"], equals: surface } }
        : {}),
    },
    select: {
      metricName: true,
      value: true,
      sessionId: true,
      userEmail: true,
      tokenType: true,
      receivedAt: true,
    },
  });

  const sessions = new Set<string>();
  const users = new Set<string>();
  let totalCost = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheTokens = 0;
  let latestReceivedAt: Date | null = null;

  for (const r of rows) {
    if (r.sessionId) sessions.add(r.sessionId);
    if (r.userEmail) users.add(r.userEmail);
    if (r.metricName === "claude_code.cost.usage") totalCost += r.value;
    if (r.metricName === "claude_code.token.usage") {
      if (r.tokenType === "input") inputTokens += r.value;
      else if (r.tokenType === "output") outputTokens += r.value;
      else if (r.tokenType === "cacheRead" || r.tokenType === "cacheCreation")
        cacheTokens += r.value;
    }
    if (!latestReceivedAt || r.receivedAt > latestReceivedAt)
      latestReceivedAt = r.receivedAt;
  }

  return {
    dataPoints: rows.length,
    activeSessions: sessions.size,
    activeUsers: users.size,
    totalCost,
    inputTokens,
    outputTokens,
    cacheTokens,
    latestReceivedAt,
  };
}

// ── Cost attribution ─────────────────────────────────────────────────────
export interface ModelCost {
  model: string;
  cost: number;
  input: number;
  output: number;
  cache: number;
}
export interface DimCost {
  dim: string;
  cost: number;
}
export interface CostAttribution {
  totalCost: number;
  byModel: ModelCost[];
  byQuerySource: DimCost[];
  byEffort: DimCost[];
  bySkill: DimCost[];
  byMcpServer: DimCost[];
  byAgent: DimCost[];
  bySurface: DimCost[];
}

export function hasAttributedData(rows: DimCost[]): boolean {
  return rows.some((r) => r.dim !== UNATTRIBUTED);
}

async function costByDimension(
  dimKey: string,
  since: Date,
  userEmail?: string | null,
  surface?: string | null,
): Promise<DimCost[]> {
  const rows = await prisma.$queryRaw<{ dim: string | null; cost: number }[]>(
    Prisma.sql`
      SELECT attributes->>${dimKey} AS dim, SUM(value)::float8 AS cost
      FROM "ClaudeCodeMetric"
      WHERE "metricName" = 'claude_code.cost.usage'
        AND "timestamp" >= ${since}
        ${userClause(userEmail)} ${metricSurfaceClause(surface)}
      GROUP BY 1
      ORDER BY cost DESC NULLS LAST
    `,
  );
  return rows
    .map((r) => ({ dim: r.dim ?? UNATTRIBUTED, cost: Number(r.cost) }))
    .filter((r) => r.cost > 0);
}

async function loadModelCosts(
  since: Date,
  userEmail?: string | null,
  surface?: string | null,
): Promise<ModelCost[]> {
  const [costRows, tokenRows] = await Promise.all([
    prisma.$queryRaw<{ model: string | null; cost: number }[]>(Prisma.sql`
      SELECT attributes->>'model' AS model, SUM(value)::float8 AS cost
      FROM "ClaudeCodeMetric"
      WHERE "metricName" = 'claude_code.cost.usage'
        AND "timestamp" >= ${since}
        ${userClause(userEmail)} ${metricSurfaceClause(surface)}
      GROUP BY 1
    `),
    prisma.$queryRaw<{ model: string | null; tt: string | null; tokens: number }[]>(Prisma.sql`
      SELECT attributes->>'model' AS model, "tokenType" AS tt, SUM(value)::float8 AS tokens
      FROM "ClaudeCodeMetric"
      WHERE "metricName" = 'claude_code.token.usage'
        AND "timestamp" >= ${since}
        ${userClause(userEmail)} ${metricSurfaceClause(surface)}
      GROUP BY 1, 2
    `),
  ]);

  const map = new Map<string, ModelCost>();
  const keyFor = (m: string | null) => m ?? "(unknown)";
  for (const c of costRows) {
    const m = keyFor(c.model);
    map.set(m, { model: m, cost: Number(c.cost), input: 0, output: 0, cache: 0 });
  }
  for (const t of tokenRows) {
    const m = keyFor(t.model);
    const entry = map.get(m) ?? { model: m, cost: 0, input: 0, output: 0, cache: 0 };
    const n = Number(t.tokens);
    if (t.tt === "input") entry.input += n;
    else if (t.tt === "output") entry.output += n;
    else if (t.tt === "cacheRead" || t.tt === "cacheCreation") entry.cache += n;
    map.set(m, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
}

export async function loadCostAttribution(
  since: Date,
  userEmail?: string | null,
  surface?: string | null,
): Promise<CostAttribution> {
  const [byModel, byQuerySource, byEffort, bySkill, byMcpServer, byAgent, bySurface] =
    await Promise.all([
      loadModelCosts(since, userEmail, surface),
      costByDimension("query_source", since, userEmail, surface),
      costByDimension("effort", since, userEmail, surface),
      costByDimension("skill.name", since, userEmail, surface),
      costByDimension("mcp_server.name", since, userEmail, surface),
      costByDimension("agent.name", since, userEmail, surface),
      costByDimension("app.entrypoint", since, userEmail, surface),
    ]);
  const totalCost = byModel.reduce((s, m) => s + m.cost, 0);
  return { totalCost, byModel, byQuerySource, byEffort, bySkill, byMcpServer, byAgent, bySurface };
}

// ── Activity & audit (events) ────────────────────────────────────────────
export interface EventActivity {
  totalEvents: number;
  byType: { name: string; count: number }[];
  decisionAccept: number;
  decisionReject: number;
  topRejectedTools: { tool: string; count: number }[];
  toolUsage: { tool: string; calls: number; successRate: number | null; avgMs: number | null }[];
  apiErrors: { label: string; count: number }[];
}

export async function loadEventActivity(
  since: Date,
  userEmail?: string | null,
  surface?: string | null,
): Promise<EventActivity> {
  const uc = userClause(userEmail);
  const sc = eventSurfaceClause(surface);
  const [byTypeRows, decisionRows, rejectedRows, toolRows, errorRows] =
    await Promise.all([
      prisma.$queryRaw<{ name: string; count: number }[]>(Prisma.sql`
        SELECT "eventName" AS name, COUNT(*)::int AS count
        FROM "ClaudeCodeEvent" WHERE "timestamp" >= ${since} ${uc} ${sc}
        GROUP BY 1 ORDER BY count DESC
      `),
      prisma.$queryRaw<{ decision: string | null; count: number }[]>(Prisma.sql`
        SELECT decision, COUNT(*)::int AS count
        FROM "ClaudeCodeEvent"
        WHERE "eventName" = 'tool_decision' AND "timestamp" >= ${since} ${uc} ${sc}
        GROUP BY 1
      `),
      prisma.$queryRaw<{ tool: string | null; count: number }[]>(Prisma.sql`
        SELECT "toolName" AS tool, COUNT(*)::int AS count
        FROM "ClaudeCodeEvent"
        WHERE "eventName" = 'tool_decision' AND decision = 'reject'
          AND "timestamp" >= ${since} ${uc} ${sc}
        GROUP BY 1 ORDER BY count DESC LIMIT 8
      `),
      prisma.$queryRaw<{ tool: string | null; calls: number; successes: number; avg_ms: number | null }[]>(Prisma.sql`
        SELECT "toolName" AS tool,
               COUNT(*)::int AS calls,
               COUNT(*) FILTER (WHERE success)::int AS successes,
               AVG("durationMs")::float8 AS avg_ms
        FROM "ClaudeCodeEvent"
        WHERE "eventName" = 'tool_result' AND "timestamp" >= ${since} ${uc} ${sc}
        GROUP BY 1 ORDER BY calls DESC LIMIT 10
      `),
      prisma.$queryRaw<{ label: string; count: number }[]>(Prisma.sql`
        SELECT COALESCE("errorType", "statusCode"::text, 'unknown')
                 || COALESCE(' · ' || model, '') AS label,
               COUNT(*)::int AS count
        FROM "ClaudeCodeEvent"
        WHERE "eventName" = 'api_error' AND "timestamp" >= ${since} ${uc} ${sc}
        GROUP BY 1 ORDER BY count DESC LIMIT 8
      `),
    ]);

  const totalEvents = byTypeRows.reduce((s, r) => s + Number(r.count), 0);
  let decisionAccept = 0;
  let decisionReject = 0;
  for (const d of decisionRows) {
    if (d.decision === "accept") decisionAccept += Number(d.count);
    else if (d.decision === "reject") decisionReject += Number(d.count);
  }

  return {
    totalEvents,
    byType: byTypeRows.map((r) => ({ name: r.name, count: Number(r.count) })),
    decisionAccept,
    decisionReject,
    topRejectedTools: rejectedRows
      .filter((r) => r.tool)
      .map((r) => ({ tool: r.tool as string, count: Number(r.count) })),
    toolUsage: toolRows.map((r) => ({
      tool: r.tool ?? "(unknown)",
      calls: Number(r.calls),
      successRate:
        Number(r.calls) > 0 ? (Number(r.successes) / Number(r.calls)) * 100 : null,
      avgMs: r.avg_ms == null ? null : Number(r.avg_ms),
    })),
    apiErrors: errorRows.map((r) => ({ label: r.label, count: Number(r.count) })),
  };
}

export async function loadRecentEvents(
  since: Date,
  userEmail?: string | null,
  surface?: string | null,
): Promise<ClaudeCodeEventRow[]> {
  return prisma.claudeCodeEvent.findMany({
    where: {
      timestamp: { gte: since },
      ...(userEmail ? { userEmail } : {}),
      ...(surface ? { entrypoint: surface } : {}),
    },
    orderBy: { timestamp: "desc" },
    take: RECENT_EVENTS_LIMIT,
    select: CLAUDE_CODE_EVENT_SELECT,
  });
}

// ── Per-user usage rollup (OTel metrics) ─────────────────────────────────
export interface CCUserRow {
  email: string;
  sessions: number;
  linesAdded: number;
  linesRemoved: number;
  commits: number;
  prs: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cost: number;
  toolAccepted: number;
  toolRejected: number;
}
export type CCTotals = Omit<CCUserRow, "email">;

function emptyUser(email: string): CCUserRow {
  return {
    email,
    sessions: 0,
    linesAdded: 0,
    linesRemoved: 0,
    commits: 0,
    prs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    cost: 0,
    toolAccepted: 0,
    toolRejected: 0,
  };
}

export async function loadOtelUsage(
  since: Date,
  userEmail?: string | null,
  surface?: string | null,
): Promise<{ users: CCUserRow[]; totals: CCTotals }> {
  const uc = userClause(userEmail);
  const sc = metricSurfaceClause(surface);
  const [scalar, lines, tokens, decisions] = await Promise.all([
    prisma.$queryRaw<{ email: string | null; metric: string; v: number }[]>(Prisma.sql`
      SELECT "userEmail" AS email, "metricName" AS metric, SUM(value)::float8 AS v
      FROM "ClaudeCodeMetric"
      WHERE "timestamp" >= ${since} ${uc} ${sc}
        AND "metricName" IN (
          'claude_code.session.count', 'claude_code.commit.count',
          'claude_code.pull_request.count', 'claude_code.cost.usage')
      GROUP BY 1, 2`),
    prisma.$queryRaw<{ email: string | null; t: string | null; v: number }[]>(Prisma.sql`
      SELECT "userEmail" AS email, "linesType" AS t, SUM(value)::float8 AS v
      FROM "ClaudeCodeMetric"
      WHERE "timestamp" >= ${since} ${uc} ${sc} AND "metricName" = 'claude_code.lines_of_code.count'
      GROUP BY 1, 2`),
    prisma.$queryRaw<{ email: string | null; t: string | null; v: number }[]>(Prisma.sql`
      SELECT "userEmail" AS email, "tokenType" AS t, SUM(value)::float8 AS v
      FROM "ClaudeCodeMetric"
      WHERE "timestamp" >= ${since} ${uc} ${sc} AND "metricName" = 'claude_code.token.usage'
      GROUP BY 1, 2`),
    prisma.$queryRaw<{ email: string | null; d: string | null; v: number }[]>(Prisma.sql`
      SELECT "userEmail" AS email, decision AS d, SUM(value)::float8 AS v
      FROM "ClaudeCodeMetric"
      WHERE "timestamp" >= ${since} ${uc} ${sc} AND "metricName" = 'claude_code.code_edit_tool.decision'
      GROUP BY 1, 2`),
  ]);

  const map = new Map<string, CCUserRow>();
  const get = (email: string | null) => {
    const k = email ?? "unknown";
    let r = map.get(k);
    if (!r) {
      r = emptyUser(k);
      map.set(k, r);
    }
    return r;
  };
  for (const s of scalar) {
    const r = get(s.email);
    const v = Number(s.v);
    if (s.metric === "claude_code.session.count") r.sessions += v;
    else if (s.metric === "claude_code.commit.count") r.commits += v;
    else if (s.metric === "claude_code.pull_request.count") r.prs += v;
    else if (s.metric === "claude_code.cost.usage") r.cost += v;
  }
  for (const l of lines) {
    const r = get(l.email);
    const v = Number(l.v);
    if (l.t === "added") r.linesAdded += v;
    else if (l.t === "removed") r.linesRemoved += v;
  }
  for (const t of tokens) {
    const r = get(t.email);
    const v = Number(t.v);
    if (t.t === "input") r.inputTokens += v;
    else if (t.t === "output") r.outputTokens += v;
    else if (t.t === "cacheRead" || t.t === "cacheCreation") r.cacheTokens += v;
  }
  for (const d of decisions) {
    const r = get(d.email);
    const v = Number(d.v);
    if (d.d === "accept") r.toolAccepted += v;
    else if (d.d === "reject") r.toolRejected += v;
  }

  const users = [...map.values()].sort((a, b) => b.cost - a.cost);
  const { email: _omit, ...zero } = emptyUser("");
  void _omit;
  const totals = users.reduce<CCTotals>((acc, u) => {
    acc.sessions += u.sessions;
    acc.linesAdded += u.linesAdded;
    acc.linesRemoved += u.linesRemoved;
    acc.commits += u.commits;
    acc.prs += u.prs;
    acc.inputTokens += u.inputTokens;
    acc.outputTokens += u.outputTokens;
    acc.cacheTokens += u.cacheTokens;
    acc.cost += u.cost;
    acc.toolAccepted += u.toolAccepted;
    acc.toolRejected += u.toolRejected;
    return acc;
  }, { ...zero });

  return { users, totals };
}

// Distinct users for the filter dropdown. When a surface is set, derive from
// events (whose `entrypoint` column is reliably populated); otherwise from
// metrics. Kept unscoped by user so the dropdown is stable.
export async function loadOtelUserList(
  since: Date,
  surface?: string | null,
): Promise<string[]> {
  if (surface) {
    const rows = await prisma.claudeCodeEvent.findMany({
      where: { timestamp: { gte: since }, entrypoint: surface, userEmail: { not: null } },
      distinct: ["userEmail"],
      select: { userEmail: true },
      orderBy: { userEmail: "asc" },
    });
    return rows.map((r) => r.userEmail).filter((e): e is string => Boolean(e));
  }
  const rows = await prisma.claudeCodeMetric.findMany({
    where: { timestamp: { gte: since }, userEmail: { not: null } },
    distinct: ["userEmail"],
    select: { userEmail: true },
    orderBy: { userEmail: "asc" },
  });
  return rows.map((r) => r.userEmail).filter((e): e is string => Boolean(e));
}
