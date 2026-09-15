import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ─── Usage by Person ──────────────────────────────────────────────────────
// One row per human across every AI surface UrNammu observes. Each surface
// has its own telemetry pipeline and its own notion of identity; this module
// normalizes them all onto a lower-cased email address so a single person
// shows up once with their Claude Code, Cowork, Cursor, and proxied API
// usage side by side.
//
// Sources (and what each contributes):
//   • Claude Code / Cowork — live OTel metrics (ClaudeCodeMetric). Cowork is
//     the `local-agent` entrypoint; everything else counts as Claude Code so
//     the two columns are disjoint and sum cleanly. When a person has no OTel
//     data in the window, the Anthropic Admin API analytics sync (UsageBucket
//     provider="claude_code") fills in sessions / lines / commits / estimated
//     cost so people whose machines are not instrumented still appear.
//   • Cursor — Cursor Admin API sync (UsageBucket provider="cursor", one row
//     per user per day). Per-user spend comes from `metadata.chargedCents`,
//     which syncCursorTelemetry records from the usage-events feed.
//   • API (proxy) — the transparent Anthropic/OpenAI proxy writes hourly
//     UsageBucket/CostBucket rows tagged source=proxy with the `x-user-email`
//     header as the actor. Flag counts come from APIUsageLog (which only
//     carries a userId when the email matches a registered User).
//
// Anthropic Console usage grouped by API key and OpenAI admin usage keyed by
// opaque user ids are deliberately NOT folded in — neither identifies a
// person by email, so they would appear as phantom people. Anything without
// an email lands in `unattributed` so totals stay honest.

import {
  SURFACE_LABELS,
  SURFACE_ORDER,
  type PeopleUsageSummary,
  type PersonSurface,
  type PersonUsageRow,
  type UnattributedUsage,
} from "./people-usage-types";
export * from "./people-usage-types";

// ── Per-source inputs (kept as plain data so the merge is unit-testable) ──

export interface OtelSurfaceUsage {
  email: string | null;
  surface: "claude_code" | "cowork";
  sessions: number;
  commits: number;
  linesAdded: number;
  tokens: number;
  cost: number;
  lastActiveAt: Date | null;
}

export interface ClaudeCodeAdminUsage {
  email: string | null;
  sessions: number;
  linesAdded: number;
  commits: number;
  tokens: number;
  cost: number;
  lastActiveAt: Date | null;
}

export interface CursorUsage {
  email: string | null;
  requests: number;
  tokens: number;
  linesAccepted: number;
  activeDays: number;
  // null when no row in the window carried chargedCents
  cost: number | null;
  lastActiveAt: Date | null;
}

export interface ProxyUsage {
  email: string | null;
  requests: number;
  tokens: number;
  cost: number;
  flagged: number;
  lastActiveAt: Date | null;
}

export interface PersonIdentity {
  email: string;
  name: string | null;
  department: string | null;
}

export interface PeopleUsageInputs {
  otel: OtelSurfaceUsage[];
  claudeCodeAdmin: ClaudeCodeAdminUsage[];
  cursor: CursorUsage[];
  proxy: ProxyUsage[];
  identities: PersonIdentity[];
}

// ── Pure helpers ──────────────────────────────────────────────────────────

/** Lower-cased, trimmed email — or null when the value is not an email. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  // Cheap shape check: one "@" with something on both sides. Rejects api-key
  // names, `user:123` ids, and other opaque actor identifiers.
  const at = v.indexOf("@");
  if (at <= 0 || at !== v.lastIndexOf("@") || at === v.length - 1) return null;
  return v;
}

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function later(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function emptyRow(email: string): PersonUsageRow {
  return {
    email,
    name: null,
    department: null,
    claudeCodeSource: null,
    claudeCodeSessions: 0,
    claudeCodeTokens: 0,
    claudeCodeLinesAdded: 0,
    claudeCodeCommits: 0,
    claudeCodeCost: 0,
    coworkSessions: 0,
    coworkTokens: 0,
    coworkCost: 0,
    cursorRequests: 0,
    cursorTokens: 0,
    cursorLinesAccepted: 0,
    cursorActiveDays: 0,
    cursorCost: null,
    proxyRequests: 0,
    proxyTokens: 0,
    proxyCost: 0,
    proxyFlagged: 0,
    totalCost: 0,
    totalTokens: 0,
    surfaces: [],
    surfaceCount: 0,
    lastActiveAt: null,
  };
}

function emptyUnattributed(): UnattributedUsage {
  return {
    cost: 0,
    tokens: 0,
    bySurface: {
      claude_code: { cost: 0, tokens: 0 },
      cowork: { cost: 0, tokens: 0 },
      cursor: { cost: 0, tokens: 0 },
      proxy: { cost: 0, tokens: 0 },
    },
  };
}

/**
 * Merge per-source aggregates into one row per person. Emails are normalized
 * here, so callers may pass raw actor strings. Rows are sorted by total cost
 * (desc), then email.
 */
export function mergePeopleUsage(inputs: PeopleUsageInputs): {
  rows: PersonUsageRow[];
  unattributed: UnattributedUsage;
} {
  const rows = new Map<string, PersonUsageRow>();
  const unattributed = emptyUnattributed();
  const get = (email: string) => {
    let r = rows.get(email);
    if (!r) {
      r = emptyRow(email);
      rows.set(email, r);
    }
    return r;
  };
  const drop = (surface: PersonSurface, cost: number, tokens: number) => {
    unattributed.cost += cost;
    unattributed.tokens += tokens;
    unattributed.bySurface[surface].cost += cost;
    unattributed.bySurface[surface].tokens += tokens;
  };

  // OTel — authoritative for Claude Code + Cowork when present.
  const otelClaudeCodeEmails = new Set<string>();
  for (const s of inputs.otel) {
    const email = normalizeEmail(s.email);
    if (!email) {
      drop(s.surface, n(s.cost), n(s.tokens));
      continue;
    }
    const r = get(email);
    if (s.surface === "cowork") {
      r.coworkSessions += n(s.sessions);
      r.coworkTokens += n(s.tokens);
      r.coworkCost += n(s.cost);
    } else {
      otelClaudeCodeEmails.add(email);
      r.claudeCodeSource = "otel";
      r.claudeCodeSessions += n(s.sessions);
      r.claudeCodeTokens += n(s.tokens);
      r.claudeCodeLinesAdded += n(s.linesAdded);
      r.claudeCodeCommits += n(s.commits);
      r.claudeCodeCost += n(s.cost);
    }
    r.lastActiveAt = later(r.lastActiveAt, s.lastActiveAt);
  }

  // Admin API analytics — fallback for people with no OTel Claude Code data.
  for (const a of inputs.claudeCodeAdmin) {
    const email = normalizeEmail(a.email);
    if (!email) {
      drop("claude_code", n(a.cost), n(a.tokens));
      continue;
    }
    if (otelClaudeCodeEmails.has(email)) continue; // OTel wins; avoid double count
    const r = get(email);
    r.claudeCodeSource = "admin_api";
    r.claudeCodeSessions += n(a.sessions);
    r.claudeCodeTokens += n(a.tokens);
    r.claudeCodeLinesAdded += n(a.linesAdded);
    r.claudeCodeCommits += n(a.commits);
    r.claudeCodeCost += n(a.cost);
    r.lastActiveAt = later(r.lastActiveAt, a.lastActiveAt);
  }

  for (const c of inputs.cursor) {
    const email = normalizeEmail(c.email);
    if (!email) {
      drop("cursor", n(c.cost), n(c.tokens));
      continue;
    }
    const r = get(email);
    r.cursorRequests += n(c.requests);
    r.cursorTokens += n(c.tokens);
    r.cursorLinesAccepted += n(c.linesAccepted);
    r.cursorActiveDays += n(c.activeDays);
    if (c.cost != null) r.cursorCost = (r.cursorCost ?? 0) + n(c.cost);
    r.lastActiveAt = later(r.lastActiveAt, c.lastActiveAt);
  }

  for (const p of inputs.proxy) {
    const email = normalizeEmail(p.email);
    if (!email) {
      drop("proxy", n(p.cost), n(p.tokens));
      continue;
    }
    const r = get(email);
    r.proxyRequests += n(p.requests);
    r.proxyTokens += n(p.tokens);
    r.proxyCost += n(p.cost);
    r.proxyFlagged += n(p.flagged);
    r.lastActiveAt = later(r.lastActiveAt, p.lastActiveAt);
  }

  // Identity enrichment: registered Users win over provider directory names.
  const identity = new Map<string, PersonIdentity>();
  for (const id of inputs.identities) {
    const email = normalizeEmail(id.email);
    if (!email) continue;
    const existing = identity.get(email);
    identity.set(email, {
      email,
      name: existing?.name ?? id.name ?? null,
      department: existing?.department ?? id.department ?? null,
    });
  }

  for (const r of rows.values()) {
    const id = identity.get(r.email);
    if (id) {
      r.name = id.name;
      r.department = id.department;
    }
    r.surfaces = [];
    if (r.claudeCodeSessions > 0 || r.claudeCodeTokens > 0 || r.claudeCodeCost > 0 || r.claudeCodeLinesAdded > 0) {
      r.surfaces.push("claude_code");
    }
    if (r.coworkSessions > 0 || r.coworkTokens > 0 || r.coworkCost > 0) r.surfaces.push("cowork");
    if (r.cursorRequests > 0 || r.cursorTokens > 0 || (r.cursorCost ?? 0) > 0 || r.cursorLinesAccepted > 0 || r.cursorActiveDays > 0) {
      r.surfaces.push("cursor");
    }
    if (r.proxyRequests > 0 || r.proxyTokens > 0 || r.proxyCost > 0) r.surfaces.push("proxy");
    r.surfaceCount = r.surfaces.length;
    r.totalCost = round2(r.claudeCodeCost + r.coworkCost + (r.cursorCost ?? 0) + r.proxyCost);
    r.totalTokens = r.claudeCodeTokens + r.coworkTokens + r.cursorTokens + r.proxyTokens;
    r.claudeCodeCost = round2(r.claudeCodeCost);
    r.coworkCost = round2(r.coworkCost);
    r.proxyCost = round2(r.proxyCost);
    if (r.cursorCost != null) r.cursorCost = round2(r.cursorCost);
  }

  unattributed.cost = round2(unattributed.cost);
  for (const s of SURFACE_ORDER) unattributed.bySurface[s].cost = round2(unattributed.bySurface[s].cost);

  const sorted = [...rows.values()].sort(
    (a, b) => b.totalCost - a.totalCost || b.totalTokens - a.totalTokens || a.email.localeCompare(b.email),
  );
  return { rows: sorted, unattributed };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function summarizePeopleUsage(
  rows: PersonUsageRow[],
  unattributed: UnattributedUsage,
): PeopleUsageSummary {
  const totalCost = round2(rows.reduce((acc, r) => acc + r.totalCost, 0));
  const totalTokens = rows.reduce((acc, r) => acc + r.totalTokens, 0);
  const bySurface = SURFACE_ORDER.map((surface) => {
    const withSurface = rows.filter((r) => r.surfaces.includes(surface));
    const cost = withSurface.reduce((acc, r) => {
      if (surface === "claude_code") return acc + r.claudeCodeCost;
      if (surface === "cowork") return acc + r.coworkCost;
      if (surface === "cursor") return acc + (r.cursorCost ?? 0);
      return acc + r.proxyCost;
    }, 0);
    const tokens = withSurface.reduce((acc, r) => {
      if (surface === "claude_code") return acc + r.claudeCodeTokens;
      if (surface === "cowork") return acc + r.coworkTokens;
      if (surface === "cursor") return acc + r.cursorTokens;
      return acc + r.proxyTokens;
    }, 0);
    return { surface, label: SURFACE_LABELS[surface], people: withSurface.length, cost: round2(cost), tokens };
  });
  return {
    people: rows.length,
    totalCost,
    totalTokens,
    avgCostPerPerson: rows.length ? round2(totalCost / rows.length) : 0,
    unattributedCost: unattributed.cost,
    bySurface,
  };
}

// ── Database loaders ──────────────────────────────────────────────────────

type OtelRow = {
  email: string | null;
  surface: string;
  metric: string;
  lines_type: string | null;
  v: number;
  last: Date | null;
};

async function loadOtelSurfaceUsage(since: Date, until: Date): Promise<OtelSurfaceUsage[]> {
  const rows = await prisma.$queryRaw<OtelRow[]>(Prisma.sql`
    SELECT
      "userEmail" AS email,
      CASE WHEN attributes->>'app.entrypoint' = 'local-agent' THEN 'cowork' ELSE 'claude_code' END AS surface,
      "metricName" AS metric,
      "linesType" AS lines_type,
      SUM(value)::float8 AS v,
      MAX("timestamp") AS last
    FROM "ClaudeCodeMetric"
    WHERE "timestamp" >= ${since} AND "timestamp" < ${until}
      AND "metricName" IN (
        'claude_code.session.count',
        'claude_code.commit.count',
        'claude_code.cost.usage',
        'claude_code.token.usage',
        'claude_code.lines_of_code.count')
    GROUP BY 1, 2, 3, 4`);

  const map = new Map<string, OtelSurfaceUsage>();
  for (const r of rows) {
    const key = `${r.email ?? ""}|${r.surface}`;
    let agg = map.get(key);
    if (!agg) {
      agg = {
        email: r.email,
        surface: r.surface === "cowork" ? "cowork" : "claude_code",
        sessions: 0,
        commits: 0,
        linesAdded: 0,
        tokens: 0,
        cost: 0,
        lastActiveAt: null,
      };
      map.set(key, agg);
    }
    const v = n(r.v);
    switch (r.metric) {
      case "claude_code.session.count":
        agg.sessions += v;
        break;
      case "claude_code.commit.count":
        agg.commits += v;
        break;
      case "claude_code.cost.usage":
        agg.cost += v;
        break;
      case "claude_code.token.usage":
        agg.tokens += v;
        break;
      case "claude_code.lines_of_code.count":
        if (r.lines_type === "added") agg.linesAdded += v;
        break;
    }
    agg.lastActiveAt = later(agg.lastActiveAt, r.last ? new Date(r.last) : null);
  }
  return [...map.values()];
}

async function loadClaudeCodeAdminUsage(since: Date, until: Date): Promise<ClaudeCodeAdminUsage[]> {
  const rows = await prisma.$queryRaw<
    { email: string | null; sessions: number; lines_added: number; commits: number; tokens: number; cost: number; last: Date | null }[]
  >(Prisma.sql`
    SELECT
      "actorExternalId" AS email,
      COALESCE(SUM((metadata->'core_metrics'->>'num_sessions')::float8), 0)::float8 AS sessions,
      COALESCE(SUM((metadata->'core_metrics'->'lines_of_code'->>'added')::float8), 0)::float8 AS lines_added,
      COALESCE(SUM((metadata->'core_metrics'->>'commits_by_claude_code')::float8), 0)::float8 AS commits,
      COALESCE(SUM((
        SELECT COALESCE(SUM(
          COALESCE((mb->'tokens'->>'input')::float8, 0) + COALESCE((mb->'tokens'->>'output')::float8, 0)
        ), 0)
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(metadata->'model_breakdown') = 'array'
               THEN metadata->'model_breakdown' ELSE '[]'::jsonb END) mb
      )), 0)::float8 AS tokens,
      COALESCE(SUM((metadata->>'estimated_cost_cents')::float8), 0)::float8 / 100 AS cost,
      MAX("bucketStart") AS last
    FROM "UsageBucket"
    WHERE provider = 'claude_code'
      AND "bucketStart" >= ${since} AND "bucketStart" < ${until}
    GROUP BY 1`);
  return rows.map((r) => ({
    email: r.email,
    sessions: n(r.sessions),
    linesAdded: n(r.lines_added),
    commits: n(r.commits),
    tokens: n(r.tokens),
    cost: n(r.cost),
    lastActiveAt: r.last ? new Date(r.last) : null,
  }));
}

async function loadCursorUsage(since: Date, until: Date): Promise<CursorUsage[]> {
  const rows = await prisma.$queryRaw<
    {
      email: string | null;
      requests: number;
      tokens: number;
      lines_accepted: number;
      active_days: number;
      cost_rows: number;
      cost: number | null;
      last: Date | null;
    }[]
  >(Prisma.sql`
    SELECT
      "actorExternalId" AS email,
      COALESCE(SUM("requestCount"), 0)::float8 AS requests,
      COALESCE(SUM("totalTokens"), 0)::float8 AS tokens,
      COALESCE(SUM((metadata->>'acceptedLinesAdded')::float8), 0)::float8 AS lines_accepted,
      COUNT(*)::int AS active_days,
      COUNT(metadata->>'chargedCents')::int AS cost_rows,
      (SUM((metadata->>'chargedCents')::float8) / 100)::float8 AS cost,
      MAX("bucketStart") AS last
    FROM "UsageBucket"
    WHERE provider = 'cursor'
      AND "bucketStart" >= ${since} AND "bucketStart" < ${until}
    GROUP BY 1`);
  return rows.map((r) => ({
    email: r.email,
    requests: n(r.requests),
    tokens: n(r.tokens),
    linesAccepted: n(r.lines_accepted),
    activeDays: n(r.active_days),
    cost: n(r.cost_rows) > 0 ? n(r.cost) : null,
    lastActiveAt: r.last ? new Date(r.last) : null,
  }));
}

async function loadProxyUsage(since: Date, until: Date): Promise<ProxyUsage[]> {
  // Proxy-written buckets are hourly and tagged source=proxy; their actor is
  // the raw x-user-email header, so people appear here even when they have no
  // User row. CostBucket rows only carry actorName, hence the COALESCE.
  const [usage, cost, flagged] = await Promise.all([
    prisma.$queryRaw<{ email: string | null; requests: number; tokens: number; last: Date | null }[]>(Prisma.sql`
      SELECT
        COALESCE("actorExternalId", "actorName") AS email,
        COALESCE(SUM("requestCount"), 0)::float8 AS requests,
        COALESCE(SUM("totalTokens"), 0)::float8 AS tokens,
        MAX("bucketStart") AS last
      FROM "UsageBucket"
      WHERE granularity = '1h' AND "dimensionKey" LIKE '%source=proxy%'
        AND "bucketStart" >= ${since} AND "bucketStart" < ${until}
      GROUP BY 1`),
    prisma.$queryRaw<{ email: string | null; cost: number }[]>(Prisma.sql`
      SELECT
        COALESCE("actorExternalId", "actorName") AS email,
        COALESCE(SUM(amount), 0)::float8 AS cost
      FROM "CostBucket"
      WHERE granularity = '1h' AND "dimensionKey" LIKE '%source=proxy%'
        AND "bucketStart" >= ${since} AND "bucketStart" < ${until}
      GROUP BY 1`),
    prisma.$queryRaw<{ email: string | null; flagged: number }[]>(Prisma.sql`
      SELECT u.email AS email, COUNT(*)::int AS flagged
      FROM "APIUsageLog" l
      LEFT JOIN "User" u ON u.id = l."userId"
      WHERE l.flagged = true
        AND l.department IS DISTINCT FROM 'admin_sync'
        AND l."createdAt" >= ${since} AND l."createdAt" < ${until}
      GROUP BY 1`),
  ]);

  const map = new Map<string, ProxyUsage>();
  const get = (raw: string | null) => {
    const key = normalizeEmail(raw) ?? "";
    let agg = map.get(key);
    if (!agg) {
      agg = { email: key || null, requests: 0, tokens: 0, cost: 0, flagged: 0, lastActiveAt: null };
      map.set(key, agg);
    }
    return agg;
  };
  for (const r of usage) {
    const agg = get(r.email);
    agg.requests += n(r.requests);
    agg.tokens += n(r.tokens);
    agg.lastActiveAt = later(agg.lastActiveAt, r.last ? new Date(r.last) : null);
  }
  for (const r of cost) get(r.email).cost += n(r.cost);
  for (const r of flagged) get(r.email).flagged += n(r.flagged);
  return [...map.values()];
}

async function loadIdentities(emails: string[]): Promise<PersonIdentity[]> {
  if (emails.length === 0) return [];
  const [users, actors] = await Promise.all([
    prisma.$queryRaw<{ email: string; name: string | null; department: string | null }[]>(Prisma.sql`
      SELECT LOWER(email) AS email, name, department
      FROM "User"
      WHERE LOWER(email) IN (${Prisma.join(emails)})`),
    prisma.$queryRaw<{ email: string; name: string | null }[]>(Prisma.sql`
      SELECT LOWER(email) AS email, MAX(name) AS name
      FROM "ProviderActor"
      WHERE email IS NOT NULL AND LOWER(email) IN (${Prisma.join(emails)})
      GROUP BY 1`),
  ]);
  // Users first so mergePeopleUsage's first-wins rule prefers them.
  return [
    ...users.map((u) => ({ email: u.email, name: u.name, department: u.department })),
    ...actors.map((a) => ({ email: a.email, name: a.name, department: null })),
  ];
}

export interface PeopleUsageResult {
  rows: PersonUsageRow[];
  unattributed: UnattributedUsage;
  summary: PeopleUsageSummary;
  since: Date;
  until: Date;
}

/** Load and merge per-person usage for a time window. */
export async function loadPeopleUsage(window: { since: Date; until: Date }): Promise<PeopleUsageResult> {
  const { since, until } = window;
  const [otel, claudeCodeAdmin, cursor, proxy] = await Promise.all([
    loadOtelSurfaceUsage(since, until),
    loadClaudeCodeAdminUsage(since, until),
    loadCursorUsage(since, until),
    loadProxyUsage(since, until),
  ]);

  const emails = new Set<string>();
  for (const s of [...otel, ...claudeCodeAdmin, ...cursor, ...proxy]) {
    const e = normalizeEmail(s.email);
    if (e) emails.add(e);
  }
  const identities = await loadIdentities([...emails]);

  const { rows, unattributed } = mergePeopleUsage({ otel, claudeCodeAdmin, cursor, proxy, identities });
  return { rows, unattributed, summary: summarizePeopleUsage(rows, unattributed), since, until };
}

/**
 * Flat, JSON-friendly rows for the report engine (PEOPLE_USAGE data source).
 * Dates become ISO strings and the surface list becomes a readable label so
 * CSV/PDF exports need no special handling.
 */
export async function loadPeopleUsageReportRows(
  range: { from: Date; to: Date } | null,
): Promise<Record<string, unknown>[]> {
  const window = range
    ? { since: range.from, until: range.to }
    : { since: new Date("2020-01-01T00:00:00.000Z"), until: new Date() };
  const { rows } = await loadPeopleUsage(window);
  return rows.map((r) => ({
    ...r,
    claudeCodeSource: r.claudeCodeSource === "otel" ? "OTel" : r.claudeCodeSource === "admin_api" ? "Admin API" : null,
    surfaces: r.surfaces.map((s) => SURFACE_LABELS[s]).join(", "),
    lastActiveAt: r.lastActiveAt ? r.lastActiveAt.toISOString() : null,
  }));
}
