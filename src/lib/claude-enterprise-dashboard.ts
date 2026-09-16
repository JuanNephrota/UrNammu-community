import { prisma } from "@/lib/prisma";
import { isAnthropicComplianceConfigured, COMPLIANCE_ALERT_SOURCE, COMPLIANCE_RECORD_PROVIDER, ANTHROPIC_COMPLIANCE_PROVIDER } from "@/lib/anthropic-compliance";
import {
  CLAUDE_ENTERPRISE_PRODUCT_LABELS,
  CLAUDE_ENTERPRISE_PRODUCTS,
  CLAUDE_ENTERPRISE_PROVIDER,
  CLAUDE_ENTERPRISE_SUMMARY_DIMENSION,
  isClaudeEnterpriseConfigured,
  type ClaudeEnterpriseProduct,
} from "@/lib/claude-enterprise-analytics";

// Data layer for the Enterprise tab of the Claude Platform oversight page.
// Sources:
//   - UsageBucket provider="claude_enterprise" dimensionKey "org_summary|…"
//       DAU / WAU / MAU, seats, pending invites per day (Analytics summaries)
//   - AssistantDailyStat provider="claude_enterprise"
//       per person × day × product activity, tokens, cost (Analytics users +
//       per-user usage / cost reports)
//   - ComplianceSession provider="anthropic"  Claude app sessions (metadata)
//   - ComplianceActivity provider="anthropic" the audit activity feed
//   - ProviderSyncRun / ProviderSyncWatermark  sync health

const WINDOW_DAYS = 30;
const RECENT_DAYS = 7;

export interface EnterpriseSyncHealth {
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  fresh: boolean;
  status: string | null;
  errorMessage: string | null;
  historyFrom: Date | null;
}

export interface ClaudeEnterpriseDashboard {
  configured: { analytics: boolean; compliance: boolean };
  hasData: boolean;
  windowDays: number;
  latest: {
    date: string;
    dau: number | null;
    wau: number | null;
    mau: number | null;
    seats: number | null;
    pendingInvites: number | null;
  } | null;
  dailyActive: { date: string; dau: number; wau: number | null; mau: number | null }[];
  products: {
    product: string;
    label: string;
    activeUsers: number;
    activeUsersRecent: number;
    requests: number;
    cost: number;
  }[];
  topUsers: {
    actorExternalId: string;
    actorName: string | null;
    cost: number;
    requests: number;
    activeDays: number;
    products: string[];
  }[];
  peopleWithActivity: number;
  totalCost: number;
  sessions: { productSurface: string; sessions: number; users: number; lastActivityAt: Date | null }[];
  compliance: {
    activities: number;
    byType: { type: string; count: number }[];
    latestActivityAt: Date | null;
    openAlerts: number;
    sessionsTotal: number;
  };
  sync: { analytics: EnterpriseSyncHealth | null; compliance: EnterpriseSyncHealth | null };
}

function productLabel(product: string): string {
  return (CLAUDE_ENTERPRISE_PRODUCT_LABELS as Record<string, string>)[product] ?? product.replace(/_/g, " ");
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function loadSyncHealth(provider: string): Promise<EnterpriseSyncHealth | null> {
  const [runs, watermark] = await Promise.all([
    prisma.providerSyncRun.findMany({
      where: { provider, syncType: "telemetry" },
      orderBy: { startedAt: "desc" },
      take: 10,
      select: { startedAt: true, completedAt: true, status: true, errorMessage: true },
    }),
    prisma.providerSyncWatermark.findUnique({ where: { provider }, select: { earliest: true } }),
  ]);
  if (runs.length === 0) return null;
  const lastSuccessAt = runs.find((r) => r.status === "SUCCEEDED")?.completedAt ?? null;
  return {
    lastRunAt: runs[0].startedAt,
    lastSuccessAt,
    fresh: !!lastSuccessAt && Date.now() - lastSuccessAt.getTime() <= 24 * 60 * 60 * 1000,
    status: runs[0].status,
    errorMessage: runs.find((r) => r.status === "FAILED")?.errorMessage ?? null,
    historyFrom: watermark?.earliest ?? null,
  };
}

export async function loadClaudeEnterpriseDashboard(): Promise<ClaudeEnterpriseDashboard> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recentSince = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);

  const [
    analyticsConfigured,
    complianceConfigured,
    summaryBuckets,
    statRows,
    sessionRows,
    activityByType,
    latestActivity,
    openAlerts,
    sessionsTotal,
    analyticsSync,
    complianceSync,
  ] = await Promise.all([
    isClaudeEnterpriseConfigured(),
    isAnthropicComplianceConfigured(),
    prisma.usageBucket.findMany({
      where: {
        provider: CLAUDE_ENTERPRISE_PROVIDER,
        dimensionKey: { startsWith: `${CLAUDE_ENTERPRISE_SUMMARY_DIMENSION}|` },
        bucketStart: { gte: since },
      },
      orderBy: { bucketStart: "asc" },
      select: { bucketStart: true, requestCount: true, metadata: true },
    }),
    prisma.assistantDailyStat.findMany({
      where: { provider: CLAUDE_ENTERPRISE_PROVIDER, day: { gte: since } },
      select: { day: true, product: true, actorExternalId: true, actorName: true, requests: true, sessions: true, estimatedCost: true },
    }),
    prisma.complianceSession.findMany({
      where: { provider: COMPLIANCE_RECORD_PROVIDER, lastActivityAt: { gte: since } },
      select: { productSurface: true, userEmail: true, lastActivityAt: true },
    }),
    prisma.complianceActivity.groupBy({
      by: ["type"],
      where: { provider: COMPLIANCE_RECORD_PROVIDER, occurredAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { type: "desc" } },
      take: 12,
    }),
    prisma.complianceActivity.findFirst({
      where: { provider: COMPLIANCE_RECORD_PROVIDER },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    }),
    prisma.alert.count({ where: { source: COMPLIANCE_ALERT_SOURCE, status: { in: ["OPEN", "ACKNOWLEDGED"] } } }),
    prisma.complianceSession.count({ where: { provider: COMPLIANCE_RECORD_PROVIDER } }),
    loadSyncHealth(CLAUDE_ENTERPRISE_PROVIDER),
    loadSyncHealth(ANTHROPIC_COMPLIANCE_PROVIDER),
  ]);

  // Org summaries → daily series + latest.
  const dailyActive = summaryBuckets.map((b) => {
    const m = (b.metadata ?? {}) as Record<string, unknown>;
    return {
      date: b.bucketStart.toISOString().slice(0, 10),
      dau: num(m.dau) ?? b.requestCount ?? 0,
      wau: num(m.wau),
      mau: num(m.mau),
      seats: num(m.seats),
      pendingInvites: num(m.pendingInvites),
    };
  });
  const latestRow = dailyActive.length ? dailyActive[dailyActive.length - 1] : null;

  // Per product and per person rollups from the daily stats.
  const productAgg = new Map<string, { users: Set<string>; recentUsers: Set<string>; requests: number; cost: number }>();
  const userAgg = new Map<string, { actorName: string | null; cost: number; requests: number; days: Set<string>; products: Set<string> }>();
  let totalCost = 0;
  for (const row of statRows) {
    const p = productAgg.get(row.product) ?? { users: new Set(), recentUsers: new Set(), requests: 0, cost: 0 };
    p.users.add(row.actorExternalId);
    if (row.day >= recentSince) p.recentUsers.add(row.actorExternalId);
    p.requests += row.requests ?? row.sessions ?? 0;
    p.cost += row.estimatedCost ?? 0;
    productAgg.set(row.product, p);

    const u = userAgg.get(row.actorExternalId) ?? { actorName: row.actorName, cost: 0, requests: 0, days: new Set(), products: new Set() };
    u.actorName = u.actorName ?? row.actorName;
    u.cost += row.estimatedCost ?? 0;
    u.requests += row.requests ?? row.sessions ?? 0;
    u.days.add(row.day.toISOString().slice(0, 10));
    u.products.add(row.product);
    userAgg.set(row.actorExternalId, u);
    totalCost += row.estimatedCost ?? 0;
  }
  const productOrder: string[] = [
    ...CLAUDE_ENTERPRISE_PRODUCTS,
    ...[...productAgg.keys()].filter((p) => !(CLAUDE_ENTERPRISE_PRODUCTS as readonly string[]).includes(p)).sort(),
  ];
  const products = productOrder
    .map((product) => {
      const agg = productAgg.get(product);
      return {
        product,
        label: productLabel(product as ClaudeEnterpriseProduct),
        activeUsers: agg?.users.size ?? 0,
        activeUsersRecent: agg?.recentUsers.size ?? 0,
        requests: agg?.requests ?? 0,
        cost: Math.round((agg?.cost ?? 0) * 100) / 100,
      };
    })
    .filter((p) => p.activeUsers > 0 || (CLAUDE_ENTERPRISE_PRODUCTS as readonly string[]).includes(p.product));

  const topUsers = [...userAgg.entries()]
    .map(([actorExternalId, u]) => ({
      actorExternalId,
      actorName: u.actorName,
      cost: Math.round(u.cost * 100) / 100,
      requests: u.requests,
      activeDays: u.days.size,
      products: productOrder.filter((p) => u.products.has(p)),
    }))
    .sort((a, b) => b.cost - a.cost || b.requests - a.requests || b.activeDays - a.activeDays || a.actorExternalId.localeCompare(b.actorExternalId))
    .slice(0, 15);

  // Sessions by product surface (compliance metadata).
  const sessionAgg = new Map<string, { sessions: number; users: Set<string>; last: Date | null }>();
  for (const s of sessionRows) {
    const key = s.productSurface ?? "unknown";
    const agg = sessionAgg.get(key) ?? { sessions: 0, users: new Set(), last: null };
    agg.sessions += 1;
    if (s.userEmail) agg.users.add(s.userEmail);
    if (s.lastActivityAt && (!agg.last || s.lastActivityAt > agg.last)) agg.last = s.lastActivityAt;
    sessionAgg.set(key, agg);
  }
  const sessions = [...sessionAgg.entries()]
    .map(([productSurface, agg]) => ({ productSurface, sessions: agg.sessions, users: agg.users.size, lastActivityAt: agg.last }))
    .sort((a, b) => b.sessions - a.sessions);

  const activities = activityByType.reduce((acc, row) => acc + row._count._all, 0);

  return {
    configured: { analytics: analyticsConfigured, compliance: complianceConfigured },
    hasData: statRows.length > 0 || summaryBuckets.length > 0 || sessionRows.length > 0 || activities > 0,
    windowDays: WINDOW_DAYS,
    latest: latestRow
      ? { date: latestRow.date, dau: latestRow.dau, wau: latestRow.wau, mau: latestRow.mau, seats: latestRow.seats, pendingInvites: latestRow.pendingInvites }
      : null,
    dailyActive: dailyActive.map(({ date, dau, wau, mau }) => ({ date, dau, wau, mau })),
    products,
    topUsers,
    peopleWithActivity: userAgg.size,
    totalCost: Math.round(totalCost * 100) / 100,
    sessions,
    compliance: {
      activities,
      byType: activityByType.map((row) => ({ type: row.type, count: row._count._all })),
      latestActivityAt: latestActivity?.occurredAt ?? null,
      openAlerts,
      sessionsTotal,
    },
    sync: { analytics: analyticsSync, compliance: complianceSync },
  };
}
