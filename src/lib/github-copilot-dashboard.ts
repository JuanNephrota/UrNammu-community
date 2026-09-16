import { prisma } from "@/lib/prisma";

// Data layer for the GitHub Copilot Oversight page. Everything here comes
// from the Copilot usage metrics sync (syncGitHubCopilotTelemetry):
//   - AssistantDailyStat provider="github_copilot" — one row per user per day
//     (interactions, accepted lines, CLI/app tokens, feature / IDE / model
//     breakdowns in metadata);
//   - UsageBucket provider="github_copilot" — one row per day carrying the
//     organization totals (DAU/WAU/MAU, pull-request metrics) in metadata;
//   - ProviderActor provider="github_copilot" — seat assignments with
//     `last_activity_at`, the identity join and the idle-seat signal.
// Copilot is seat-licensed, so there is deliberately no cost surface;
// `ai_credits_used` is surfaced as credits, never converted to money.

export const COPILOT_DASHBOARD_DAYS = 28;
/** A seat with no Copilot activity for this long is reported as idle. */
export const COPILOT_IDLE_SEAT_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export interface CopilotBreakdownRow {
  key: string;
  interactions: number;
  generated: number;
  accepted: number;
  linesAccepted: number;
  /** accepted / generated, null when nothing was generated. */
  acceptanceRate: number | null;
  users: number;
}

export interface CopilotDashboard {
  windowDays: number;
  since: Date;
  sync: {
    configured: boolean;
    lastRunAt: Date | null;
    lastRunStatus: string | null;
    lastRunError: string | null;
    watermark: Date | null;
    earliest: Date | null;
    pendingDays: string[];
  };
  summary: {
    seats: number;
    activeUsers: number;
    interactions: number;
    linesAccepted: number;
    linesSuggested: number;
    codeGenerated: number;
    codeAccepted: number;
    acceptanceRate: number | null;
    tokens: number | null;
    creditsUsed: number | null;
    daysWithData: number;
  };
  /** Latest organization-day totals from the aggregate report, if synced. */
  org: {
    day: string;
    dailyActiveUsers: number | null;
    weeklyActiveUsers: number | null;
    monthlyActiveUsers: number | null;
    monthlyActiveChatUsers: number | null;
    monthlyActiveAgentUsers: number | null;
    pullRequests: {
      created: number | null;
      createdByCopilot: number | null;
      merged: number | null;
      mergedCreatedByCopilot: number | null;
      reviewed: number | null;
      reviewedByCopilot: number | null;
      copilotSuggestions: number | null;
      copilotAppliedSuggestions: number | null;
      medianMinutesToMerge: number | null;
      medianMinutesToMergeCopilotAuthored: number | null;
    } | null;
  } | null;
  /** Window-wide PR totals summed over every synced org day. */
  pullRequests28d: {
    created: number;
    createdByCopilot: number;
    merged: number;
    mergedCreatedByCopilot: number;
    reviewedByCopilot: number;
    copilotSuggestions: number;
    copilotAppliedSuggestions: number;
    days: number;
  } | null;
  byFeature: CopilotBreakdownRow[];
  byIde: CopilotBreakdownRow[];
  byModel: CopilotBreakdownRow[];
  byLanguage: CopilotBreakdownRow[];
  thirdPartyAgents: { agent: string; interactions: number; users: number }[];
  adoptionPhases: { phase: string; users: number }[];
  daily: { day: string; activeUsers: number; interactions: number; linesAccepted: number }[];
  users: {
    actor: string;
    login: string;
    email: string | null;
    interactions: number;
    linesAccepted: number;
    linesSuggested: number;
    acceptanceRate: number | null;
    activeDays: number;
    lastActiveDay: Date | null;
    ides: string[];
    phase: string | null;
    creditsUsed: number | null;
  }[];
  idleSeats: {
    actor: string;
    login: string;
    email: string | null;
    lastActivityAt: Date | null;
    lastActivityEditor: string | null;
    planType: string | null;
  }[];
  /** Every actor seen in the window (for the user filter), independent of the current filter. */
  allUsers: string[];
}

function breakdown(
  rowsByUser: Map<string, Record<string, unknown>[]>,
  keyField: string,
): CopilotBreakdownRow[] {
  const agg = new Map<string, CopilotBreakdownRow & { userSet: Set<string> }>();
  for (const [actor, entries] of rowsByUser) {
    for (const entry of entries) {
      const key = str(entry[keyField]);
      if (!key) continue;
      let row = agg.get(key);
      if (!row) {
        row = { key, interactions: 0, generated: 0, accepted: 0, linesAccepted: 0, acceptanceRate: null, users: 0, userSet: new Set() };
        agg.set(key, row);
      }
      row.interactions += num(entry.interactions);
      row.generated += num(entry.generated);
      row.accepted += num(entry.accepted);
      row.linesAccepted += num(entry.locAdded);
      row.userSet.add(actor);
    }
  }
  return [...agg.values()]
    .map(({ userSet, ...row }) => ({
      ...row,
      users: userSet.size,
      acceptanceRate: row.generated > 0 ? row.accepted / row.generated : null,
    }))
    .sort((a, b) => b.linesAccepted - a.linesAccepted || b.interactions - a.interactions || a.key.localeCompare(b.key))
    .slice(0, 12);
}

export async function loadCopilotDashboard(
  userFilter?: string | null,
  windowDays: number = COPILOT_DASHBOARD_DAYS,
): Promise<CopilotDashboard> {
  const now = new Date();
  const since = startOfUtcDay(new Date(now.getTime() - windowDays * DAY_MS));
  const actorWhere = userFilter ? { actorExternalId: userFilter } : {};

  const [rows, orgBuckets, actors, lastRun, watermark, allActorRows] = await Promise.all([
    prisma.assistantDailyStat.findMany({
      where: { provider: "github_copilot", day: { gte: since }, ...actorWhere },
      orderBy: { day: "asc" },
      select: {
        actorExternalId: true,
        actorName: true,
        day: true,
        isActive: true,
        requests: true,
        linesAccepted: true,
        toolAccepted: true,
        inputTokens: true,
        outputTokens: true,
        metadata: true,
      },
    }),
    prisma.usageBucket.findMany({
      where: { provider: "github_copilot", granularity: "day", bucketStart: { gte: since } },
      orderBy: { bucketStart: "asc" },
      select: { bucketStart: true, metadata: true },
    }),
    prisma.providerActor.findMany({
      where: { provider: "github_copilot" },
      select: { externalId: true, name: true, email: true, role: true, lastSeenAt: true, metadata: true },
    }),
    prisma.providerSyncRun.findFirst({
      where: { provider: "github_copilot", syncType: "telemetry" },
      orderBy: { startedAt: "desc" },
      select: { status: true, startedAt: true, completedAt: true, errorMessage: true, metadata: true },
    }),
    prisma.providerSyncWatermark.findUnique({ where: { provider: "github_copilot" } }),
    prisma.assistantDailyStat.findMany({
      where: { provider: "github_copilot", day: { gte: since } },
      distinct: ["actorExternalId"],
      select: { actorExternalId: true },
      orderBy: { actorExternalId: "asc" },
    }),
  ]);

  // ── Per-user aggregation ──
  type UserAgg = CopilotDashboard["users"][number] & { generated: number; accepted: number; ideSet: Set<string>; credits: number; sawCredits: boolean };
  const users = new Map<string, UserAgg>();
  const featureRows = new Map<string, Record<string, unknown>[]>();
  const ideRows = new Map<string, Record<string, unknown>[]>();
  const modelRows = new Map<string, Record<string, unknown>[]>();
  const languageRows = new Map<string, Record<string, unknown>[]>();
  const agentAgg = new Map<string, { interactions: number; users: Set<string> }>();
  const daily = new Map<string, { activeUsers: Set<string>; interactions: number; linesAccepted: number }>();

  let interactions = 0;
  let linesAccepted = 0;
  let linesSuggested = 0;
  let codeGenerated = 0;
  let codeAccepted = 0;
  let tokens = 0;
  let sawTokens = false;
  let credits = 0;
  let sawCredits = false;
  const activeUsers = new Set<string>();

  for (const row of rows) {
    const meta = asRecord(row.metadata);
    const actor = row.actorExternalId;
    const dayKey = row.day.toISOString().slice(0, 10);
    const rowInteractions = num(row.requests);
    const rowLines = num(row.linesAccepted);
    const generated = num(meta.codeGenerationCount);
    const accepted = num(meta.codeAcceptanceCount ?? row.toolAccepted);
    const suggested = num(meta.locSuggestedToAdd);
    const active = row.isActive !== false;

    let u = users.get(actor);
    if (!u) {
      u = {
        actor,
        login: str(meta.login) ?? row.actorName ?? actor,
        email: actor.includes("@") ? actor : null,
        interactions: 0,
        linesAccepted: 0,
        linesSuggested: 0,
        acceptanceRate: null,
        activeDays: 0,
        lastActiveDay: null,
        ides: [],
        phase: null,
        creditsUsed: null,
        generated: 0,
        accepted: 0,
        ideSet: new Set(),
        credits: 0,
        sawCredits: false,
      };
      users.set(actor, u);
    }
    u.interactions += rowInteractions;
    u.linesAccepted += rowLines;
    u.linesSuggested += suggested;
    u.generated += generated;
    u.accepted += accepted;
    if (active) {
      u.activeDays += 1;
      if (!u.lastActiveDay || row.day > u.lastActiveDay) u.lastActiveDay = row.day;
      activeUsers.add(actor);
    }
    if (str(meta.adoptionPhase)) u.phase = str(meta.adoptionPhase);
    if (typeof meta.aiCreditsUsed === "number") {
      u.credits += meta.aiCreditsUsed;
      u.sawCredits = true;
      credits += meta.aiCreditsUsed;
      sawCredits = true;
    }
    for (const ide of asArray(meta.ides)) {
      const name = str(ide.ide);
      if (name) u.ideSet.add(name);
    }

    interactions += rowInteractions;
    linesAccepted += rowLines;
    linesSuggested += suggested;
    codeGenerated += generated;
    codeAccepted += accepted;
    if (row.inputTokens != null || row.outputTokens != null) {
      sawTokens = true;
      tokens += num(row.inputTokens) + num(row.outputTokens);
    }

    const push = (map: Map<string, Record<string, unknown>[]>, entries: Record<string, unknown>[]) => {
      if (entries.length === 0) return;
      const list = map.get(actor) ?? [];
      list.push(...entries);
      map.set(actor, list);
    };
    push(featureRows, asArray(meta.features));
    push(ideRows, asArray(meta.ides));
    push(modelRows, asArray(meta.models));
    push(languageRows, asArray(meta.languages));
    for (const agent of asArray(meta.thirdPartyAgents)) {
      const name = str(agent.agentName);
      if (!name) continue;
      const a = agentAgg.get(name) ?? { interactions: 0, users: new Set<string>() };
      a.interactions += num(agent.interactions);
      a.users.add(actor);
      agentAgg.set(name, a);
    }

    const d = daily.get(dayKey) ?? { activeUsers: new Set<string>(), interactions: 0, linesAccepted: 0 };
    if (active) d.activeUsers.add(actor);
    d.interactions += rowInteractions;
    d.linesAccepted += rowLines;
    daily.set(dayKey, d);
  }

  const phaseCounts = new Map<string, number>();
  for (const u of users.values()) {
    if (u.phase) phaseCounts.set(u.phase, (phaseCounts.get(u.phase) ?? 0) + 1);
  }

  // ── Seats / idle seats ──
  const idleCutoff = new Date(now.getTime() - COPILOT_IDLE_SEAT_DAYS * DAY_MS);
  const seatActors = actors.filter((a) => asRecord(a.metadata).hasSeat === true);
  const idleSeats = seatActors
    .map((a) => {
      const meta = asRecord(a.metadata);
      const lastActivityRaw = str(meta.lastActivityAt);
      const lastActivityAt = lastActivityRaw ? new Date(lastActivityRaw) : null;
      return {
        actor: a.externalId,
        login: str(meta.login) ?? a.name ?? a.externalId,
        email: a.email,
        lastActivityAt: lastActivityAt && !Number.isNaN(lastActivityAt.getTime()) ? lastActivityAt : null,
        lastActivityEditor: str(meta.lastActivityEditor),
        planType: a.role,
      };
    })
    .filter((seat) => {
      const seenInWindow = users.get(seat.actor)?.activeDays ?? 0;
      if (seenInWindow > 0) return false;
      return !seat.lastActivityAt || seat.lastActivityAt < idleCutoff;
    })
    .sort((a, b) => (a.lastActivityAt?.getTime() ?? 0) - (b.lastActivityAt?.getTime() ?? 0));

  // ── Org totals ──
  const latestOrg = orgBuckets.length > 0 ? orgBuckets[orgBuckets.length - 1] : null;
  const latestMeta = latestOrg ? asRecord(latestOrg.metadata) : null;
  const latestPr = latestMeta ? asRecord(latestMeta.pullRequests) : {};
  const prTotals = orgBuckets.reduce(
    (acc, bucket) => {
      const pr = asRecord(asRecord(bucket.metadata).pullRequests);
      if (Object.keys(pr).length === 0) return acc;
      acc.days += 1;
      acc.created += num(pr.created);
      acc.createdByCopilot += num(pr.createdByCopilot);
      acc.merged += num(pr.merged);
      acc.mergedCreatedByCopilot += num(pr.mergedCreatedByCopilot);
      acc.reviewedByCopilot += num(pr.reviewedByCopilot);
      acc.copilotSuggestions += num(pr.copilotSuggestions);
      acc.copilotAppliedSuggestions += num(pr.copilotAppliedSuggestions);
      return acc;
    },
    { created: 0, createdByCopilot: 0, merged: 0, mergedCreatedByCopilot: 0, reviewedByCopilot: 0, copilotSuggestions: 0, copilotAppliedSuggestions: 0, days: 0 },
  );

  const nullableNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const runMeta = asRecord(lastRun?.metadata);

  return {
    windowDays,
    since,
    sync: {
      configured: actors.length > 0 || rows.length > 0 || !!lastRun,
      lastRunAt: lastRun?.completedAt ?? lastRun?.startedAt ?? null,
      lastRunStatus: lastRun?.status ?? null,
      lastRunError: lastRun?.errorMessage ?? null,
      watermark: watermark?.watermark ?? null,
      earliest: watermark?.earliest ?? null,
      pendingDays: Array.isArray(runMeta.pendingDays) ? (runMeta.pendingDays as unknown[]).filter((d): d is string => typeof d === "string") : [],
    },
    summary: {
      seats: seatActors.length,
      activeUsers: activeUsers.size,
      interactions,
      linesAccepted,
      linesSuggested,
      codeGenerated,
      codeAccepted,
      acceptanceRate: codeGenerated > 0 ? codeAccepted / codeGenerated : null,
      tokens: sawTokens ? tokens : null,
      creditsUsed: sawCredits ? Math.round(credits * 100) / 100 : null,
      daysWithData: daily.size,
    },
    org:
      latestOrg && latestMeta
        ? {
            day: latestOrg.bucketStart.toISOString().slice(0, 10),
            dailyActiveUsers: nullableNum(latestMeta.dailyActiveUsers),
            weeklyActiveUsers: nullableNum(latestMeta.weeklyActiveUsers),
            monthlyActiveUsers: nullableNum(latestMeta.monthlyActiveUsers),
            monthlyActiveChatUsers: nullableNum(latestMeta.monthlyActiveChatUsers),
            monthlyActiveAgentUsers: nullableNum(latestMeta.monthlyActiveAgentUsers),
            pullRequests:
              Object.keys(latestPr).length > 0
                ? {
                    created: nullableNum(latestPr.created),
                    createdByCopilot: nullableNum(latestPr.createdByCopilot),
                    merged: nullableNum(latestPr.merged),
                    mergedCreatedByCopilot: nullableNum(latestPr.mergedCreatedByCopilot),
                    reviewed: nullableNum(latestPr.reviewed),
                    reviewedByCopilot: nullableNum(latestPr.reviewedByCopilot),
                    copilotSuggestions: nullableNum(latestPr.copilotSuggestions),
                    copilotAppliedSuggestions: nullableNum(latestPr.copilotAppliedSuggestions),
                    medianMinutesToMerge: nullableNum(latestPr.medianMinutesToMerge),
                    medianMinutesToMergeCopilotAuthored: nullableNum(latestPr.medianMinutesToMergeCopilotAuthored),
                  }
                : null,
          }
        : null,
    pullRequests28d: prTotals.days > 0 ? prTotals : null,
    byFeature: breakdown(featureRows, "feature"),
    byIde: breakdown(ideRows, "ide"),
    byModel: breakdown(modelRows, "model"),
    byLanguage: breakdown(languageRows, "language"),
    thirdPartyAgents: [...agentAgg.entries()]
      .map(([agent, a]) => ({ agent, interactions: a.interactions, users: a.users.size }))
      .sort((a, b) => b.interactions - a.interactions),
    adoptionPhases: [...phaseCounts.entries()]
      .map(([phase, count]) => ({ phase, users: count }))
      .sort((a, b) => a.phase.localeCompare(b.phase)),
    daily: [...daily.entries()]
      .map(([day, d]) => ({ day, activeUsers: d.activeUsers.size, interactions: d.interactions, linesAccepted: d.linesAccepted }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    users: [...users.values()]
      .map(({ generated, accepted, ideSet, credits: c, sawCredits: sc, ...u }) => ({
        ...u,
        ides: [...ideSet].sort(),
        acceptanceRate: generated > 0 ? accepted / generated : null,
        creditsUsed: sc ? Math.round(c * 100) / 100 : null,
      }))
      .filter((u) => u.activeDays > 0 || u.interactions > 0 || u.linesAccepted > 0)
      .sort((a, b) => b.linesAccepted - a.linesAccepted || b.interactions - a.interactions || a.actor.localeCompare(b.actor)),
    idleSeats,
    allUsers: allActorRows.map((r) => r.actorExternalId),
  };
}
