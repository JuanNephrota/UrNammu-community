import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const EMPTY = Prisma.empty;
function prismaUserClause(userEmail: string) {
  return Prisma.sql`AND "userEmail" = ${userEmail}`;
}

// Data layer for the Cursor Oversight page. Sourced entirely from OTel data
// landed by the cursor-otel-hook → collector → UrNammu pipeline:
//   - CursorSpan   (raw spans, audit trail)
//   - CursorMetric (derived cursor.* activity metrics)
//
// Cursor's hook carries NO token counts or cost, so everything here is
// activity-based: tool use, sessions, span durations, hook-event volume, and
// dangerous-prompt verdicts. There is intentionally no cost surface.

export function cursorSevenDaysAgo(): Date {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}
function sixtyMinutesAgo(): Date {
  return new Date(Date.now() - 60 * 60 * 1000);
}

export const CURSOR_RECENT_SPANS_LIMIT = 60;

export interface CursorDashboard {
  live: {
    spans: number;
    activeSessions: number;
    activeUsers: number;
    latestReceivedAt: Date | null;
  };
  summary: {
    totalSpans: number;
    sessions: number;
    users: number;
    toolCalls: number;
    flaggedSpans: number;
    avgDurationMs: number | null;
    maxDurationMs: number | null;
    // Authoritative on-demand spend (USD) from the Cursor Admin API sync
    // (CostBucket provider="cursor"), last 7 days. Null until a sync has run.
    cost7d: number | null;
  };
  topTools: { tool: string; count: number }[];
  byHookEvent: { hookEvent: string; count: number }[];
  topUsers: { userEmail: string; count: number }[];
  // All distinct attributed users in the window (for the user-filter picker).
  // Independent of the current filter so the dropdown always lists everyone.
  allUsers: string[];
  // Per-user lines of code, from the Cursor Admin API daily-usage sync
  // (UsageBucket provider="cursor" metadata). Empty until a sync has run —
  // the OTel span pipeline does not carry line counts.
  userLines: {
    user: string;
    acceptedLinesAdded: number;
    totalLinesAdded: number;
    totalLinesDeleted: number;
    activeDays: number;
  }[];
  recentSpans: {
    id: string;
    timestamp: Date;
    spanName: string;
    spanKind: string | null;
    hookEvent: string | null;
    genAiToolName: string | null;
    genAiModel: string | null;
    userEmail: string | null;
    durationMs: number | null;
    success: boolean | null;
    riskSeverity: string | null;
  }[];
  riskFlags: {
    id: string;
    timestamp: Date;
    riskSeverity: string | null;
    riskCategory: string | null;
    userEmail: string | null;
    spanName: string;
  }[];
}

export async function loadCursorDashboard(
  userEmail?: string | null,
): Promise<CursorDashboard> {
  const since = cursorSevenDaysAgo();
  const liveSince = sixtyMinutesAgo();
  const userWhere = userEmail ? { userEmail } : {};

  const [
    liveSpans,
    liveAgg,
    latestRow,
    totalSpans,
    flaggedSpans,
    toolCalls,
    distinctAgg,
    durationAgg,
    toolGroups,
    hookGroups,
    userGroups,
    recentSpans,
    riskFlags,
    costAgg,
    allUsersRows,
    usageRows,
  ] = await Promise.all([
    prisma.cursorSpan.count({
      where: { timestamp: { gte: liveSince }, ...userWhere },
    }),
    // Distinct live sessions/users via raw count.
    prisma.$queryRaw<{ sessions: bigint; users: bigint }[]>`
      SELECT
        COUNT(DISTINCT "sessionId")::bigint AS sessions,
        COUNT(DISTINCT "userEmail")::bigint AS users
      FROM "CursorSpan"
      WHERE "timestamp" >= ${liveSince}
        ${userEmail ? prismaUserClause(userEmail) : EMPTY}
    `,
    prisma.cursorSpan.findFirst({
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true },
    }),
    prisma.cursorSpan.count({ where: { timestamp: { gte: since }, ...userWhere } }),
    prisma.cursorSpan.count({
      where: { timestamp: { gte: since }, riskSeverity: { not: null }, ...userWhere },
    }),
    prisma.cursorSpan.count({
      where: { timestamp: { gte: since }, genAiToolName: { not: null }, ...userWhere },
    }),
    prisma.$queryRaw<{ sessions: bigint; users: bigint }[]>`
      SELECT
        COUNT(DISTINCT "sessionId")::bigint AS sessions,
        COUNT(DISTINCT "userEmail")::bigint AS users
      FROM "CursorSpan"
      WHERE "timestamp" >= ${since}
        ${userEmail ? prismaUserClause(userEmail) : EMPTY}
    `,
    prisma.cursorSpan.aggregate({
      where: { timestamp: { gte: since }, durationMs: { not: null }, ...userWhere },
      _avg: { durationMs: true },
      _max: { durationMs: true },
    }),
    prisma.cursorSpan.groupBy({
      by: ["genAiToolName"],
      where: { timestamp: { gte: since }, genAiToolName: { not: null }, ...userWhere },
      _count: { _all: true },
      orderBy: { _count: { genAiToolName: "desc" } },
      take: 10,
    }),
    prisma.cursorSpan.groupBy({
      by: ["hookEvent"],
      where: { timestamp: { gte: since }, hookEvent: { not: null }, ...userWhere },
      _count: { _all: true },
      orderBy: { _count: { hookEvent: "desc" } },
      take: 12,
    }),
    prisma.cursorSpan.groupBy({
      by: ["userEmail"],
      where: { timestamp: { gte: since }, userEmail: { not: null }, ...userWhere },
      _count: { _all: true },
      orderBy: { _count: { userEmail: "desc" } },
      take: 10,
    }),
    prisma.cursorSpan.findMany({
      where: { timestamp: { gte: since }, ...userWhere },
      orderBy: { timestamp: "desc" },
      take: CURSOR_RECENT_SPANS_LIMIT,
      select: {
        id: true,
        timestamp: true,
        spanName: true,
        spanKind: true,
        hookEvent: true,
        genAiToolName: true,
        genAiModel: true,
        userEmail: true,
        durationMs: true,
        success: true,
        riskSeverity: true,
      },
    }),
    prisma.cursorSpan.findMany({
      where: { timestamp: { gte: since }, riskSeverity: { not: null }, ...userWhere },
      orderBy: { timestamp: "desc" },
      take: 20,
      select: {
        id: true,
        timestamp: true,
        riskSeverity: true,
        riskCategory: true,
        userEmail: true,
        spanName: true,
      },
    }),
    // Authoritative spend from the Cursor Admin API sync (team-wide; cost
    // buckets aren't per-user, so this ignores the user filter).
    prisma.costBucket.aggregate({
      where: { provider: "cursor", bucketStart: { gte: since } },
      _sum: { amount: true },
    }),
    // All distinct attributed users in the window — for the filter dropdown.
    // NOT scoped by userWhere so every user appears even when one is selected.
    prisma.cursorSpan.findMany({
      where: { timestamp: { gte: since }, userEmail: { not: null } },
      distinct: ["userEmail"],
      select: { userEmail: true },
      orderBy: { userEmail: "asc" },
    }),
    // Lines of code per user, from the Admin API daily-usage sync. The line
    // counts live in UsageBucket.metadata; aggregate in JS (small N: users×7d).
    // actorExternalId is the user's email (set by syncCursorTelemetry).
    prisma.usageBucket.findMany({
      where: {
        provider: "cursor",
        bucketStart: { gte: since },
        ...(userEmail ? { actorExternalId: userEmail } : {}),
      },
      select: { actorExternalId: true, actorName: true, metadata: true },
    }),
  ]);

  const live = liveAgg[0];
  const distinct = distinctAgg[0];

  // ── Aggregate per-user lines from UsageBucket metadata ──
  const linesByUser = new Map<
    string,
    { acceptedLinesAdded: number; totalLinesAdded: number; totalLinesDeleted: number; activeDays: number }
  >();
  for (const row of usageRows) {
    const md = (row.metadata ?? {}) as Record<string, unknown>;
    const user = row.actorExternalId ?? row.actorName ?? "(unattributed)";
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const agg = linesByUser.get(user) ?? {
      acceptedLinesAdded: 0,
      totalLinesAdded: 0,
      totalLinesDeleted: 0,
      activeDays: 0,
    };
    agg.acceptedLinesAdded += n(md.acceptedLinesAdded);
    agg.totalLinesAdded += n(md.totalLinesAdded);
    agg.totalLinesDeleted += n(md.totalLinesDeleted);
    agg.activeDays += 1;
    linesByUser.set(user, agg);
  }
  const userLines = [...linesByUser.entries()]
    .map(([user, v]) => ({ user, ...v }))
    .sort((a, b) => b.acceptedLinesAdded - a.acceptedLinesAdded);

  return {
    live: {
      spans: liveSpans,
      activeSessions: Number(live?.sessions ?? 0),
      activeUsers: Number(live?.users ?? 0),
      latestReceivedAt: latestRow?.receivedAt ?? null,
    },
    summary: {
      totalSpans,
      sessions: Number(distinct?.sessions ?? 0),
      users: Number(distinct?.users ?? 0),
      toolCalls,
      flaggedSpans,
      avgDurationMs: durationAgg._avg.durationMs ?? null,
      maxDurationMs: durationAgg._max.durationMs ?? null,
      cost7d: costAgg._sum.amount ?? null,
    },
    topTools: toolGroups.map((g) => ({
      tool: g.genAiToolName ?? "(unknown)",
      count: g._count._all,
    })),
    byHookEvent: hookGroups.map((g) => ({
      hookEvent: g.hookEvent ?? "(unknown)",
      count: g._count._all,
    })),
    topUsers: userGroups.map((g) => ({
      userEmail: g.userEmail ?? "(unattributed)",
      count: g._count._all,
    })),
    allUsers: allUsersRows
      .map((r) => r.userEmail)
      .filter((e): e is string => !!e),
    userLines,
    recentSpans,
    riskFlags,
  };
}
