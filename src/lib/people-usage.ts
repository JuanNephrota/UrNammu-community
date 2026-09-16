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
//     data in the window, the Anthropic Admin API analytics sync
//     (AssistantDailyStat provider="claude_code") fills in sessions / lines /
//     commits / estimated cost so people whose machines are not instrumented
//     still appear.
//   • Claude Enterprise — Claude Enterprise Analytics API sync
//     (AssistantDailyStat provider="claude_enterprise", one row per person per
//     day per product). Chat, Cowork-as-reported-by-Anthropic, Design and
//     Office roll into the Claude Enterprise column; the claude_code product
//     is skipped because Claude Code already has its own column fed by OTel /
//     the Admin API analytics report, and counting it twice would inflate the
//     person's total.
//   • Cursor — Cursor Admin API sync (AssistantDailyStat provider="cursor",
//     one row per member per day). Per-user spend is the `estimatedCost`
//     column, which syncCursorTelemetry fills from the usage-events feed and
//     leaves null when that feed returned nothing.
//   • GitHub Copilot — usage metrics sync (AssistantDailyStat
//     provider="github_copilot"). The actor is the seat's email when GitHub
//     exposes one, otherwise the GitHub login — logins are not emails, so
//     those rows land in `unattributed` until directory sync can resolve them.
//     Copilot is seat-licensed: no cost column.
//   • API (proxy) — the transparent Anthropic/OpenAI proxy writes hourly
//     UsageBucket/CostBucket rows tagged source=proxy with the `x-user-email`
//     header as the actor. Flag counts come from APIUsageLog (which only
//     carries a userId when the email matches a registered User).
//
// Anthropic Console usage grouped by API key and OpenAI admin usage keyed by
// opaque user ids are deliberately NOT folded in — neither identifies a
// person by email, so they would appear as phantom people. Anything without
// an email lands in `unattributed` so totals stay honest.
//
// Identity: when a directory sync (Settings → Users & Identity) has populated
// DirectoryPerson, every observed email is first resolved through the
// alias → primary map, so a person seen as `ada.lovelace@` in Cursor and
// `ada@` in the proxy is one row keyed by the directory primary. Name and
// department come from the directory first, then the UrNammu User, then the
// provider member list; `directoryStatus` flags leavers still showing usage.

import {
  SURFACE_LABELS,
  SURFACE_ORDER,
  type PeopleUsageSummary,
  type PersonSurface,
  type PersonUsageRow,
  type UnattributedUsage,
} from "./people-usage-types";
import {
  buildAliasMap,
  buildDirectoryIndex,
  directoryStatusFor,
  resolveAlias,
  type DirectoryIdentity,
} from "./directory-identity";
export * from "./people-usage-types";
export type { DirectoryIdentity } from "./directory-identity";

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

export interface ClaudeEnterpriseUsage {
  email: string | null;
  activeDays: number;
  messages: number;
  tokens: number;
  // null when no row in the window carried per-user cost
  cost: number | null;
  products: string[];
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

export interface CopilotUsage {
  email: string | null;
  interactions: number;
  tokens: number;
  linesAccepted: number;
  activeDays: number;
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
  claudeEnterprise?: ClaudeEnterpriseUsage[];
  cursor: CursorUsage[];
  copilot: CopilotUsage[];
  proxy: ProxyUsage[];
  /** Registered Users first, then provider member directories (first wins). */
  identities: PersonIdentity[];
  /**
   * Synced identity-provider directory (DirectoryPerson). Every observed
   * email is resolved through its alias map before merging, so
   * `ada.lovelace@` and `ada@` collapse onto one row keyed by the directory
   * primary; name / department come from here before `identities`.
   */
  directory?: DirectoryIdentity[];
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
    directoryStatus: "unknown",
    claudeCodeSource: null,
    claudeCodeSessions: 0,
    claudeCodeTokens: 0,
    claudeCodeLinesAdded: 0,
    claudeCodeCommits: 0,
    claudeCodeCost: 0,
    coworkSessions: 0,
    coworkTokens: 0,
    coworkCost: 0,
    enterpriseActiveDays: 0,
    enterpriseMessages: 0,
    enterpriseTokens: 0,
    enterpriseCost: null,
    enterpriseProducts: [],
    cursorRequests: 0,
    cursorTokens: 0,
    cursorLinesAccepted: 0,
    cursorActiveDays: 0,
    cursorCost: null,
    copilotInteractions: 0,
    copilotTokens: 0,
    copilotLinesAccepted: 0,
    copilotActiveDays: 0,
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
      claude_enterprise: { cost: 0, tokens: 0 },
      cursor: { cost: 0, tokens: 0 },
      github_copilot: { cost: 0, tokens: 0 },
      proxy: { cost: 0, tokens: 0 },
    },
  };
}

/**
 * Merge per-source aggregates into one row per person. Emails are normalized
 * here (and folded onto the directory primary when `inputs.directory` knows
 * the address as an alias), so callers may pass raw actor strings. Rows are
 * sorted by total cost (desc), then email.
 */
export function mergePeopleUsage(inputs: PeopleUsageInputs): {
  rows: PersonUsageRow[];
  unattributed: UnattributedUsage;
} {
  const directory = inputs.directory ?? [];
  const aliasMap = buildAliasMap(directory);
  const directoryIndex = buildDirectoryIndex(directory);
  const resolve = (raw: string | null | undefined) => resolveAlias(normalizeEmail(raw), aliasMap);

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
    const email = resolve(s.email);
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
    const email = resolve(a.email);
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

  for (const e of inputs.claudeEnterprise ?? []) {
    const email = resolve(e.email);
    if (!email) {
      drop("claude_enterprise", n(e.cost), n(e.tokens));
      continue;
    }
    const r = get(email);
    r.enterpriseActiveDays += n(e.activeDays);
    r.enterpriseMessages += n(e.messages);
    r.enterpriseTokens += n(e.tokens);
    if (e.cost != null) r.enterpriseCost = (r.enterpriseCost ?? 0) + n(e.cost);
    for (const product of e.products) if (!r.enterpriseProducts.includes(product)) r.enterpriseProducts.push(product);
    r.lastActiveAt = later(r.lastActiveAt, e.lastActiveAt);
  }

  for (const c of inputs.cursor) {
    const email = resolve(c.email);
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

  for (const c of inputs.copilot) {
    const email = normalizeEmail(c.email);
    if (!email) {
      // Copilot rows keyed by GitHub login (no seat email) cannot be merged
      // with a person yet; count their tokens as unattributed, never as cost.
      drop("github_copilot", 0, n(c.tokens));
      continue;
    }
    const r = get(email);
    r.copilotInteractions += n(c.interactions);
    r.copilotTokens += n(c.tokens);
    r.copilotLinesAccepted += n(c.linesAccepted);
    r.copilotActiveDays += n(c.activeDays);
    r.lastActiveAt = later(r.lastActiveAt, c.lastActiveAt);
  }

  for (const p of inputs.proxy) {
    const email = resolve(p.email);
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

  // Identity enrichment: the synced IdP directory wins, then registered
  // Users, then provider member directories (first non-null wins per field).
  const identity = new Map<string, PersonIdentity>();
  for (const id of inputs.identities) {
    const email = resolve(id.email);
    if (!email) continue;
    const existing = identity.get(email);
    identity.set(email, {
      email,
      name: existing?.name ?? id.name ?? null,
      department: existing?.department ?? id.department ?? null,
    });
  }

  for (const r of rows.values()) {
    const dir = directoryIndex.get(r.email);
    const id = identity.get(r.email);
    r.name = dir?.displayName ?? id?.name ?? null;
    r.department = dir?.department ?? id?.department ?? null;
    r.directoryStatus = directoryStatusFor(dir);
    r.surfaces = [];
    if (r.claudeCodeSessions > 0 || r.claudeCodeTokens > 0 || r.claudeCodeCost > 0 || r.claudeCodeLinesAdded > 0) {
      r.surfaces.push("claude_code");
    }
    if (r.coworkSessions > 0 || r.coworkTokens > 0 || r.coworkCost > 0) r.surfaces.push("cowork");
    if (r.enterpriseActiveDays > 0 || r.enterpriseMessages > 0 || r.enterpriseTokens > 0 || (r.enterpriseCost ?? 0) > 0) {
      r.surfaces.push("claude_enterprise");
    }
    if (r.cursorRequests > 0 || r.cursorTokens > 0 || (r.cursorCost ?? 0) > 0 || r.cursorLinesAccepted > 0 || r.cursorActiveDays > 0) {
      r.surfaces.push("cursor");
    }
    if (r.copilotInteractions > 0 || r.copilotTokens > 0 || r.copilotLinesAccepted > 0 || r.copilotActiveDays > 0) {
      r.surfaces.push("github_copilot");
    }
    if (r.proxyRequests > 0 || r.proxyTokens > 0 || r.proxyCost > 0) r.surfaces.push("proxy");
    r.surfaceCount = r.surfaces.length;
    r.totalCost = round2(
      r.claudeCodeCost + r.coworkCost + (r.enterpriseCost ?? 0) + (r.cursorCost ?? 0) + r.proxyCost,
    );
    r.totalTokens =
      r.claudeCodeTokens + r.coworkTokens + r.enterpriseTokens + r.cursorTokens + r.copilotTokens + r.proxyTokens;
    r.claudeCodeCost = round2(r.claudeCodeCost);
    r.coworkCost = round2(r.coworkCost);
    r.proxyCost = round2(r.proxyCost);
    if (r.cursorCost != null) r.cursorCost = round2(r.cursorCost);
    if (r.enterpriseCost != null) r.enterpriseCost = round2(r.enterpriseCost);
    r.enterpriseProducts.sort();
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
      if (surface === "claude_enterprise") return acc + (r.enterpriseCost ?? 0);
      if (surface === "cursor") return acc + (r.cursorCost ?? 0);
      if (surface === "github_copilot") return acc; // seat-licensed, no metered cost
      return acc + r.proxyCost;
    }, 0);
    const tokens = withSurface.reduce((acc, r) => {
      if (surface === "claude_code") return acc + r.claudeCodeTokens;
      if (surface === "cowork") return acc + r.coworkTokens;
      if (surface === "claude_enterprise") return acc + r.enterpriseTokens;
      if (surface === "cursor") return acc + r.cursorTokens;
      if (surface === "github_copilot") return acc + r.copilotTokens;
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

/** The AssistantDailyStat columns Usage by Person reads (one row per provider × day × person). */
export interface AssistantDailyStatRow {
  provider: string;
  day: Date;
  actorExternalId: string;
  /** "" for single-surface providers; the product for claude_enterprise. */
  product?: string;
  isActive: boolean | null;
  sessions: number | null;
  requests: number | null;
  linesAdded: number | null;
  linesAccepted: number | null;
  commits: number | null;
  estimatedCost: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * Roll AssistantDailyStat rows up to one Claude Code (Admin API) and one
 * Cursor aggregate per actor. Pure, so the column semantics are testable:
 *   - tokens are input + output (cache tokens are reported separately and
 *     would inflate the cross-surface total);
 *   - a Cursor day counts as active unless the provider marked it inactive,
 *     and "last active" only advances on active days;
 *   - Cursor cost stays null until at least one day carried charged spend;
 *   - Cursor members with nothing to report in the window are dropped (the
 *     daily-usage feed lists every seat every day, active or not);
 *   - Claude Enterprise rows roll up per person across products, except the
 *     claude_code product (already covered by the Claude Code column); a day
 *     counts as active once however many products were used; cost stays
 *     null until at least one row carried the per-user cost report;
 *   - GitHub Copilot rows count `requests` as interactions and `isActive`
 *     days as active days; cost is never derived (seat-licensed).
 */
export function rollupAssistantDailyStats(rows: AssistantDailyStatRow[]): {
  claudeCodeAdmin: ClaudeCodeAdminUsage[];
  cursor: CursorUsage[];
  claudeEnterprise: ClaudeEnterpriseUsage[];
  copilot: CopilotUsage[];
} {
  const claudeCode = new Map<string, ClaudeCodeAdminUsage>();
  const cursor = new Map<string, CursorUsage>();
  const enterprise = new Map<string, ClaudeEnterpriseUsage & { days: Set<string> }>();
  const copilot = new Map<string, CopilotUsage>();
  for (const row of rows) {
    const tokens = n(row.inputTokens) + n(row.outputTokens);
    if (row.provider === "claude_enterprise") {
      const product = row.product ?? "";
      if (product === "claude_code") continue;
      let agg = enterprise.get(row.actorExternalId);
      if (!agg) {
        agg = { email: row.actorExternalId, activeDays: 0, messages: 0, tokens: 0, cost: null, products: [], lastActiveAt: null, days: new Set() };
        enterprise.set(row.actorExternalId, agg);
      }
      const day = row.day.toISOString().slice(0, 10);
      if (row.isActive !== false && !agg.days.has(day)) {
        agg.days.add(day);
        agg.activeDays += 1;
        agg.lastActiveAt = later(agg.lastActiveAt, row.day);
      }
      agg.messages += n(row.requests);
      agg.tokens += tokens;
      if (row.estimatedCost != null) agg.cost = (agg.cost ?? 0) + n(row.estimatedCost);
      if (product && !agg.products.includes(product)) agg.products.push(product);
      continue;
    }
    if (row.provider === "claude_code") {
      let agg = claudeCode.get(row.actorExternalId);
      if (!agg) {
        agg = { email: row.actorExternalId, sessions: 0, linesAdded: 0, commits: 0, tokens: 0, cost: 0, lastActiveAt: null };
        claudeCode.set(row.actorExternalId, agg);
      }
      agg.sessions += n(row.sessions);
      agg.linesAdded += n(row.linesAdded);
      agg.commits += n(row.commits);
      agg.tokens += tokens;
      agg.cost += n(row.estimatedCost);
      agg.lastActiveAt = later(agg.lastActiveAt, row.day);
    } else if (row.provider === "cursor") {
      let agg = cursor.get(row.actorExternalId);
      if (!agg) {
        agg = { email: row.actorExternalId, requests: 0, tokens: 0, linesAccepted: 0, activeDays: 0, cost: null, lastActiveAt: null };
        cursor.set(row.actorExternalId, agg);
      }
      agg.requests += n(row.requests);
      agg.tokens += tokens;
      agg.linesAccepted += n(row.linesAccepted);
      if (row.isActive !== false) {
        agg.activeDays += 1;
        agg.lastActiveAt = later(agg.lastActiveAt, row.day);
      }
      if (row.estimatedCost != null) agg.cost = (agg.cost ?? 0) + n(row.estimatedCost);
    } else if (row.provider === "github_copilot") {
      let agg = copilot.get(row.actorExternalId);
      if (!agg) {
        agg = { email: row.actorExternalId, interactions: 0, tokens: 0, linesAccepted: 0, activeDays: 0, lastActiveAt: null };
        copilot.set(row.actorExternalId, agg);
      }
      agg.interactions += n(row.requests);
      agg.tokens += tokens;
      agg.linesAccepted += n(row.linesAccepted);
      if (row.isActive !== false) {
        agg.activeDays += 1;
        agg.lastActiveAt = later(agg.lastActiveAt, row.day);
      }
    }
  }
  return {
    claudeCodeAdmin: [...claudeCode.values()],
    cursor: [...cursor.values()].filter(
      (c) => c.activeDays > 0 || c.requests > 0 || c.tokens > 0 || c.linesAccepted > 0 || (c.cost ?? 0) > 0,
    ),
    claudeEnterprise: [...enterprise.values()]
      .filter((e) => e.activeDays > 0 || e.messages > 0 || e.tokens > 0 || (e.cost ?? 0) > 0)
      .map((e) => ({
        email: e.email,
        activeDays: e.activeDays,
        messages: e.messages,
        tokens: e.tokens,
        cost: e.cost,
        products: [...e.products].sort(),
        lastActiveAt: e.lastActiveAt,
      })),
    copilot: [...copilot.values()].filter(
      (c) => c.activeDays > 0 || c.interactions > 0 || c.tokens > 0 || c.linesAccepted > 0,
    ),
  };
}

async function loadAssistantDailyStatRows(since: Date, until: Date): Promise<AssistantDailyStatRow[]> {
  return prisma.assistantDailyStat.findMany({
    where: {
      provider: { in: ["claude_code", "cursor", "claude_enterprise", "github_copilot"] },
      day: { gte: since, lt: until },
    },
    select: {
      provider: true,
      day: true,
      actorExternalId: true,
      product: true,
      isActive: true,
      sessions: true,
      requests: true,
      linesAdded: true,
      linesAccepted: true,
      commits: true,
      estimatedCost: true,
      inputTokens: true,
      outputTokens: true,
    },
  });
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

/**
 * DirectoryPerson rows matching the observed emails, by primary address or
 * alias. Returns the read-side shape so mergePeopleUsage can build its alias
 * map and enrichment index without touching Prisma types.
 */
async function loadDirectoryIdentities(emails: string[]): Promise<DirectoryIdentity[]> {
  if (emails.length === 0) return [];
  const rows = await prisma.directoryPerson.findMany({
    where: { OR: [{ primaryEmail: { in: emails } }, { aliases: { hasSome: emails } }] },
    select: {
      primaryEmail: true,
      aliases: true,
      displayName: true,
      department: true,
      active: true,
      deactivatedAt: true,
    },
    // Active rows first so buildDirectoryIndex keeps the live record when the
    // same person exists in two sources.
    orderBy: [{ active: "desc" }, { lastSyncedAt: "desc" }],
  });
  return rows;
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
  const [otel, assistantRows, proxy] = await Promise.all([
    loadOtelSurfaceUsage(since, until),
    loadAssistantDailyStatRows(since, until),
    loadProxyUsage(since, until),
  ]);
  const { claudeCodeAdmin, cursor, claudeEnterprise, copilot } = rollupAssistantDailyStats(assistantRows);

  const observed = new Set<string>();
  for (const s of [...otel, ...claudeCodeAdmin, ...claudeEnterprise, ...cursor, ...copilot, ...proxy]) {
    const e = normalizeEmail(s.email);
    if (e) observed.add(e);
  }
  // Directory first: observed aliases resolve to primaries, and the User /
  // ProviderActor lookup must cover both spellings.
  const directory = await loadDirectoryIdentities([...observed]);
  const aliasMap = buildAliasMap(directory);
  const emails = new Set(observed);
  for (const e of observed) {
    const primary = resolveAlias(e, aliasMap);
    if (primary) emails.add(primary);
  }
  const identities = await loadIdentities([...emails]);

  const { rows, unattributed } = mergePeopleUsage({
    otel,
    claudeCodeAdmin,
    claudeEnterprise,
    cursor,
    copilot,
    proxy,
    identities,
    directory,
  });
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
    enterpriseProducts: r.enterpriseProducts.join(", "),
    lastActiveAt: r.lastActiveAt ? r.lastActiveAt.toISOString() : null,
  }));
}
