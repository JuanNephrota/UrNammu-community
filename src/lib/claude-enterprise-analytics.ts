import { getSetting } from "./settings";
import type { AssistantDailyStatValues } from "./assistant-daily-stats";

// ─── Claude Enterprise Analytics API ───────────────────────────────────────
// Per-user daily activity and cost for a Claude Enterprise organization.
//
// Reference (verified 2026-09-16), Analytics API key with scope read:analytics:
//   GET /v1/organizations/analytics/users?date=YYYY-MM-DD
//       one row per user: chat_metrics, claude_code_metrics, cowork_metrics,
//       design_metrics, office_metrics, web_search_count, last_activity_date
//   GET /v1/organizations/analytics/summaries?starting_date=YYYY-MM-DD
//       per day: DAU / WAU / MAU, seats, pending invites
//   GET /v1/organizations/analytics/user_usage_report?starting_at=…
//   GET /v1/organizations/analytics/user_cost_report?starting_at=…
//       actor { user_id, email, name, deleted }, product, model, tokens incl.
//       cache, `amount` in fractional cents; cursor page / next_page
//   Data lags ~1 day; cost is revised for up to 30 days. 60 requests/minute.
//
// Everything here except the fetchers is pure so the mappers can be tested
// without the network. The sync loop (provider-telemetry.ts) owns Prisma.

export const CLAUDE_ENTERPRISE_SETTINGS = {
  ANALYTICS_KEY: "anthropic_analytics_key",
} as const;

export const CLAUDE_ENTERPRISE_PROVIDER = "claude_enterprise";

export const CLAUDE_ENTERPRISE_PRODUCTS = ["chat", "claude_code", "cowork", "design", "office"] as const;
export type ClaudeEnterpriseProduct = (typeof CLAUDE_ENTERPRISE_PRODUCTS)[number];

export const CLAUDE_ENTERPRISE_PRODUCT_LABELS: Record<ClaudeEnterpriseProduct, string> = {
  chat: "Claude.ai chat",
  claude_code: "Claude Code",
  cowork: "Cowork",
  design: "Design",
  office: "Office add-ins",
};

/** `dimensionKey` prefix of the org-level daily summary UsageBucket rows. */
export const CLAUDE_ENTERPRISE_SUMMARY_DIMENSION = "org_summary";

const BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
export const CLAUDE_ENTERPRISE_MAX_PAGES = 50;
/** Days re-pulled behind the watermark (≈1-day lag + cost revisions). */
export const CLAUDE_ENTERPRISE_OVERLAP_DAYS = 3;
export const CLAUDE_ENTERPRISE_DEFAULT_LOOKBACK_DAYS = 7;
/** Hard ceiling on days per run so a long gap cannot blow the 5-min budget. */
export const CLAUDE_ENTERPRISE_MAX_DAYS_PER_RUN = 14;
const RATE_LIMIT_PER_MINUTE = 60;

export async function isClaudeEnterpriseConfigured(): Promise<boolean> {
  return !!(await getSetting(CLAUDE_ENTERPRISE_SETTINGS.ANALYTICS_KEY));
}

async function getAnalyticsKey(): Promise<string> {
  const key = await getSetting(CLAUDE_ENTERPRISE_SETTINGS.ANALYTICS_KEY);
  if (!key) throw new Error("Claude Enterprise Analytics API key not configured. Add it in Integrations → Claude Enterprise Analytics.");
  return key;
}

// ── Rate limiter (60 rpm per org) ─────────────────────────────────────────

const requestTimestamps: number[] = [];

async function throttle(): Promise<void> {
  const now = Date.now();
  while (requestTimestamps.length && now - requestTimestamps[0] > 60_000) requestTimestamps.shift();
  if (requestTimestamps.length >= RATE_LIMIT_PER_MINUTE - 5) {
    const wait = 60_000 - (now - requestTimestamps[0]) + 50;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  requestTimestamps.push(Date.now());
}

async function analyticsFetch(path: string, key: string): Promise<unknown> {
  await throttle();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
      message = parsed?.error?.message ?? parsed?.message ?? text;
    } catch {
      /* plain text */
    }
    throw new Error(`Claude Enterprise Analytics API error (${res.status}): ${message}`);
  }
  return res.json();
}

// ── Value helpers ─────────────────────────────────────────────────────────

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function num(v: unknown): number {
  const x = typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : NaN;
  return Number.isFinite(x) ? x : 0;
}

function intOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? Math.round(x) : null;
}

function firstNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = intOrNull(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = str(source[key]);
    if (value) return value;
  }
  return null;
}

/** "YYYY-MM-DD" for a Date (UTC). */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** UTC midnight for a "YYYY-MM-DD" or ISO timestamp; null when unparseable. */
export function dayStart(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(`${isoDay(value)}T00:00:00.000Z`);
  const s = str(value);
  if (!s) return null;
  const d = new Date(s.length === 10 ? `${s}T00:00:00.000Z` : s);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(`${isoDay(d)}T00:00:00.000Z`);
}

/** Sum of every finite number anywhere inside a metrics object. */
export function sumNumeric(value: unknown, depth = 0): number {
  if (depth > 4) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (Array.isArray(value)) return value.reduce<number>((acc, v) => acc + sumNumeric(v, depth + 1), 0);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).reduce<number>((acc, v) => acc + sumNumeric(v, depth + 1), 0);
  }
  return 0;
}

/** Upstream product names → the closed set above (unknown values pass through lower-cased). */
export function normalizeEnterpriseProduct(raw: unknown): string {
  const p = (str(raw) ?? "").toLowerCase().replace(/[\s.-]+/g, "_");
  if (!p) return "chat";
  if (p === "claude" || p === "claude_ai" || p === "claude_web" || p === "web" || p === "chat" || p === "claude_chat") return "chat";
  if (p === "code" || p === "claude_code" || p === "claudecode") return "claude_code";
  if (p === "cowork" || p === "claude_cowork") return "cowork";
  if (p === "design" || p === "claude_design") return "design";
  if (p === "office" || p === "office_addins" || p === "office_add_ins" || p === "claude_office") return "office";
  return p;
}

// ── Actor ─────────────────────────────────────────────────────────────────

export interface EnterpriseActor {
  email: string | null;
  name: string | null;
  userId: string | null;
  deleted: boolean;
}

export function parseEnterpriseActor(raw: unknown): EnterpriseActor {
  const r = rec(raw);
  const a = rec(r.actor);
  const u = rec(r.user);
  const source = Object.keys(a).length ? a : Object.keys(u).length ? u : r;
  const email = firstString(source, ["email", "email_address", "user_email"]);
  return {
    email: email ? email.toLowerCase() : null,
    name: firstString(source, ["name", "display_name", "user_name"]),
    userId: firstString(source, ["user_id", "id"]) ?? firstString(r, ["user_id"]),
    deleted: source.deleted === true,
  };
}

/** Stable actor id: email when present, else `user:<id>` so nothing is dropped. */
export function enterpriseActorExternalId(actor: EnterpriseActor): string | null {
  if (actor.email) return actor.email;
  if (actor.userId) return `user:${actor.userId}`;
  return null;
}

// ── /analytics/users → AssistantDailyStat rows ────────────────────────────

const REQUEST_KEYS = ["messages", "message_count", "num_messages", "messages_sent", "prompts", "prompt_count", "requests", "request_count", "interactions", "actions", "action_count", "edits", "generations", "generation_count"];
const SESSION_KEYS = ["sessions", "session_count", "num_sessions", "conversations", "conversation_count", "chats", "tasks", "task_count", "documents", "document_count"];

/**
 * One row per product that has any activity for this user-day. Products the
 * upstream row omits (or reports as all-zero) produce no row, so "no row"
 * means "not used that day" for every product alike. Tokens and cost are
 * left null here and filled from the per-user usage / cost reports by
 * `mergeEnterpriseDailyStats`.
 */
export function enterpriseUserToDailyStats(raw: unknown, day: Date): AssistantDailyStatValues[] {
  const r = rec(raw);
  const actor = parseEnterpriseActor(r);
  const externalId = enterpriseActorExternalId(actor);
  if (!externalId) return [];
  const actorName = actor.name ?? (actor.email ? actor.email.split("@")[0] : externalId);
  const shared = {
    last_activity_date: str(r.last_activity_date),
    web_search_count: intOrNull(r.web_search_count),
    user_id: actor.userId,
    deleted: actor.deleted,
  };

  const rows: AssistantDailyStatValues[] = [];
  for (const product of CLAUDE_ENTERPRISE_PRODUCTS) {
    const metrics = rec(r[`${product}_metrics`]);
    if (Object.keys(metrics).length === 0) continue;
    const activity = sumNumeric(metrics);
    if (activity <= 0) continue;

    const lines = rec(metrics.lines_of_code);
    const toolActions = rec(metrics.tool_actions);
    let toolAccepted: number | null = null;
    let toolRejected: number | null = null;
    if (Object.keys(toolActions).length) {
      toolAccepted = 0;
      toolRejected = 0;
      for (const action of Object.values(toolActions)) {
        const a = rec(action);
        toolAccepted += num(a.accepted);
        toolRejected += num(a.rejected);
      }
    }
    const tokens = rec(metrics.tokens);
    const hasTokens = Object.keys(tokens).length > 0;

    rows.push({
      provider: "claude_enterprise",
      day,
      actorExternalId: externalId,
      product,
      actorName,
      isActive: true,
      sessions: firstNumber(metrics, SESSION_KEYS),
      requests: firstNumber(metrics, REQUEST_KEYS),
      linesAdded: firstNumber(lines, ["added"]) ?? firstNumber(metrics, ["lines_added", "lines_of_code_added"]),
      linesRemoved: firstNumber(lines, ["removed", "deleted"]) ?? firstNumber(metrics, ["lines_removed", "lines_deleted"]),
      linesAccepted: firstNumber(metrics, ["lines_accepted", "accepted_lines"]),
      commits: firstNumber(metrics, ["commits", "commits_by_claude_code", "commit_count"]),
      pullRequests: firstNumber(metrics, ["pull_requests", "pull_requests_by_claude_code", "pr_count"]),
      toolAccepted,
      toolRejected,
      estimatedCost: null,
      inputTokens: hasTokens ? intOrNull(tokens.input ?? tokens.input_tokens) : null,
      outputTokens: hasTokens ? intOrNull(tokens.output ?? tokens.output_tokens) : null,
      cacheReadTokens: hasTokens ? intOrNull(tokens.cache_read ?? tokens.cache_read_input_tokens) : null,
      cacheCreationTokens: hasTokens ? intOrNull(tokens.cache_creation ?? tokens.cache_creation_input_tokens) : null,
      metadata: { ...shared, metrics },
    });
  }
  return rows;
}

// ── /analytics/summaries ──────────────────────────────────────────────────

export interface EnterpriseDailySummary {
  /** "YYYY-MM-DD" */
  date: string;
  dau: number | null;
  wau: number | null;
  mau: number | null;
  seats: number | null;
  pendingInvites: number | null;
  raw: Record<string, unknown>;
}

export function parseEnterpriseSummary(raw: unknown): EnterpriseDailySummary | null {
  const r = rec(raw);
  const day = dayStart(r.date ?? r.day ?? r.starting_date ?? r.starting_at);
  if (!day) return null;
  const active = rec(r.active_users);
  return {
    date: isoDay(day),
    dau: firstNumber(r, ["daily_active_users", "dau"]) ?? firstNumber(active, ["daily", "dau"]),
    wau: firstNumber(r, ["weekly_active_users", "wau"]) ?? firstNumber(active, ["weekly", "wau"]),
    mau: firstNumber(r, ["monthly_active_users", "mau"]) ?? firstNumber(active, ["monthly", "mau"]),
    seats: firstNumber(r, ["seats", "total_seats", "seat_count", "licensed_seats", "seats_total"]) ?? firstNumber(rec(r.seats), ["total", "count"]),
    pendingInvites: firstNumber(r, ["pending_invites", "invites_pending", "pending_invitations"]) ?? firstNumber(rec(r.seats), ["pending_invites", "pending"]),
    raw: r,
  };
}

// ── /analytics/user_usage_report and /user_cost_report ────────────────────

export interface EnterpriseUsageRow {
  day: Date;
  actor: EnterpriseActor;
  actorExternalId: string;
  product: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  requests: number | null;
  raw: Record<string, unknown>;
}

export function parseEnterpriseUsageRow(raw: unknown): EnterpriseUsageRow | null {
  const r = rec(raw);
  const day = dayStart(r.starting_at ?? r.date ?? r.day);
  const actor = parseEnterpriseActor(r);
  const actorExternalId = enterpriseActorExternalId(actor);
  if (!day || !actorExternalId) return null;
  const tokens = rec(r.tokens);
  return {
    day,
    actor,
    actorExternalId,
    product: normalizeEnterpriseProduct(r.product ?? r.product_surface ?? r.surface),
    model: str(r.model),
    inputTokens: num(tokens.input ?? tokens.uncached_input ?? r.uncached_input_tokens ?? r.input_tokens),
    outputTokens: num(tokens.output ?? r.output_tokens),
    cacheReadTokens: num(tokens.cache_read ?? r.cache_read_input_tokens ?? r.cache_read_tokens),
    cacheCreationTokens: num(tokens.cache_creation ?? r.cache_creation_input_tokens ?? r.cache_creation_tokens),
    requests: firstNumber(r, ["requests", "request_count", "messages", "message_count"]),
    raw: r,
  };
}

export interface EnterpriseCostRow {
  day: Date;
  actor: EnterpriseActor;
  actorExternalId: string;
  product: string;
  model: string | null;
  /** USD. Upstream `amount` is fractional cents. */
  amountUsd: number;
  currency: string;
  raw: Record<string, unknown>;
}

export function parseEnterpriseCostRow(raw: unknown): EnterpriseCostRow | null {
  const r = rec(raw);
  const day = dayStart(r.starting_at ?? r.date ?? r.day);
  const actor = parseEnterpriseActor(r);
  const actorExternalId = enterpriseActorExternalId(actor);
  if (!day || !actorExternalId) return null;
  const amountCents = typeof r.amount === "object" && r.amount !== null ? num(rec(r.amount).amount ?? rec(r.amount).value) : num(r.amount);
  return {
    day,
    actor,
    actorExternalId,
    product: normalizeEnterpriseProduct(r.product ?? r.product_surface ?? r.surface),
    model: str(r.model),
    amountUsd: amountCents / 100,
    currency: (str(r.currency) ?? (typeof r.amount === "object" ? str(rec(r.amount).currency) : null) ?? "USD").toLowerCase(),
    raw: r,
  };
}

// ── Merge per-user reports into the daily stats ───────────────────────────

const statKey = (day: Date, actorExternalId: string, product: string) => `${isoDay(day)}|${actorExternalId}|${product}`;

/**
 * Fill tokens and cost on the (day, person, product) stat rows from the two
 * per-user reports, creating rows for combinations the activity endpoint did
 * not list (e.g. a user whose only activity that day was billed API-style
 * usage). Report rows sum across models. Tokens on a stat are only touched
 * when the usage report has something for it, so the activity endpoint's own
 * token figures (if any) survive on days the report lacks.
 */
export function mergeEnterpriseDailyStats(
  stats: AssistantDailyStatValues[],
  usage: EnterpriseUsageRow[],
  cost: EnterpriseCostRow[],
): AssistantDailyStatValues[] {
  const byKey = new Map<string, AssistantDailyStatValues>();
  for (const s of stats) byKey.set(statKey(s.day, s.actorExternalId, s.product), s);

  const ensure = (day: Date, actor: EnterpriseActor, actorExternalId: string, product: string) => {
    const key = statKey(day, actorExternalId, product);
    let row = byKey.get(key);
    if (!row) {
      row = {
        provider: "claude_enterprise",
        day,
        actorExternalId,
        product,
        actorName: actor.name ?? (actor.email ? actor.email.split("@")[0] : actorExternalId),
        isActive: true,
        sessions: null,
        requests: null,
        linesAdded: null,
        linesRemoved: null,
        linesAccepted: null,
        commits: null,
        pullRequests: null,
        toolAccepted: null,
        toolRejected: null,
        estimatedCost: null,
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheCreationTokens: null,
        metadata: { user_id: actor.userId, deleted: actor.deleted, from_reports_only: true },
      };
      byKey.set(key, row);
    }
    return row;
  };

  const touchedTokens = new Set<string>();
  for (const u of usage) {
    const row = ensure(u.day, u.actor, u.actorExternalId, u.product);
    const key = statKey(u.day, u.actorExternalId, u.product);
    if (!touchedTokens.has(key)) {
      touchedTokens.add(key);
      row.inputTokens = 0;
      row.outputTokens = 0;
      row.cacheReadTokens = 0;
      row.cacheCreationTokens = 0;
    }
    row.inputTokens = (row.inputTokens ?? 0) + Math.round(u.inputTokens);
    row.outputTokens = (row.outputTokens ?? 0) + Math.round(u.outputTokens);
    row.cacheReadTokens = (row.cacheReadTokens ?? 0) + Math.round(u.cacheReadTokens);
    row.cacheCreationTokens = (row.cacheCreationTokens ?? 0) + Math.round(u.cacheCreationTokens);
    if (u.requests != null && row.requests == null) row.requests = 0;
    if (u.requests != null) row.requests = (row.requests ?? 0) + u.requests;
    const models = (row.metadata.models as Record<string, number> | undefined) ?? {};
    if (u.model) models[u.model] = (models[u.model] ?? 0) + u.inputTokens + u.outputTokens;
    row.metadata = { ...row.metadata, models };
  }

  for (const c of cost) {
    const row = ensure(c.day, c.actor, c.actorExternalId, c.product);
    row.estimatedCost = Math.round(((row.estimatedCost ?? 0) + c.amountUsd) * 1_000_000) / 1_000_000;
  }

  return [...byKey.values()];
}

// ── Sync window ───────────────────────────────────────────────────────────

/**
 * Days to pull this run: from `overlapDays` before the watermark (or the
 * default lookback on the first run) up to and including yesterday UTC,
 * because today's numbers are not final and the API lags about a day.
 * Capped at `maxDays` oldest-first so a long gap drains over several runs.
 */
export function planEnterpriseDays(input: {
  watermark: Date | null;
  now: Date;
  overlapDays?: number;
  lookbackDays?: number;
  maxDays?: number;
}): string[] {
  const overlap = input.overlapDays ?? CLAUDE_ENTERPRISE_OVERLAP_DAYS;
  const lookback = input.lookbackDays ?? CLAUDE_ENTERPRISE_DEFAULT_LOOKBACK_DAYS;
  const maxDays = input.maxDays ?? CLAUDE_ENTERPRISE_MAX_DAYS_PER_RUN;
  const todayMs = Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth(), input.now.getUTCDate());
  const lastDayMs = todayMs - 24 * 60 * 60 * 1000;
  const startMs = input.watermark
    ? Date.UTC(input.watermark.getUTCFullYear(), input.watermark.getUTCMonth(), input.watermark.getUTCDate()) - overlap * 24 * 60 * 60 * 1000
    : todayMs - lookback * 24 * 60 * 60 * 1000;
  const days: string[] = [];
  for (let ms = startMs; ms <= lastDayMs && days.length < maxDays; ms += 24 * 60 * 60 * 1000) {
    days.push(isoDay(new Date(ms)));
  }
  return days;
}

// ── Fetchers ──────────────────────────────────────────────────────────────

export interface EnterprisePagedResult {
  items: unknown[];
  pages: number;
  truncated: boolean;
}

function parsePage(body: unknown): { items: unknown[]; nextPage: string | null } {
  const r = rec(body);
  const items = Array.isArray(r.data) ? r.data : Array.isArray(r.users) ? r.users : Array.isArray(r.results) ? r.results : [];
  const nextPage = r.has_more === false ? null : str(r.next_page);
  return { items, nextPage };
}

async function fetchAllPages(key: string, path: string, baseQuery: URLSearchParams, maxPages = CLAUDE_ENTERPRISE_MAX_PAGES): Promise<EnterprisePagedResult> {
  const items: unknown[] = [];
  let page: string | null = null;
  let pages = 0;
  do {
    const q = new URLSearchParams(baseQuery);
    if (page) q.set("page", page);
    const body = await analyticsFetch(`${path}?${q.toString()}`, key);
    const parsed = parsePage(body);
    items.push(...parsed.items);
    pages += 1;
    page = parsed.nextPage;
  } while (page && pages < maxPages);
  return { items, pages, truncated: !!page };
}

export async function getEnterpriseUsersForDay(date: string): Promise<EnterprisePagedResult> {
  const key = await getAnalyticsKey();
  const q = new URLSearchParams({ date, limit: "1000" });
  return fetchAllPages(key, "/v1/organizations/analytics/users", q);
}

export async function getEnterpriseSummaries(startingDate: string, endingDate?: string): Promise<EnterprisePagedResult> {
  const key = await getAnalyticsKey();
  const q = new URLSearchParams({ starting_date: startingDate });
  if (endingDate) q.set("ending_date", endingDate);
  return fetchAllPages(key, "/v1/organizations/analytics/summaries", q);
}

export async function getEnterpriseUserUsageReport(startingAt: string, endingAt?: string): Promise<EnterprisePagedResult> {
  const key = await getAnalyticsKey();
  const q = new URLSearchParams({ starting_at: startingAt, limit: "1000" });
  if (endingAt) q.set("ending_at", endingAt);
  return fetchAllPages(key, "/v1/organizations/analytics/user_usage_report", q);
}

export async function getEnterpriseUserCostReport(startingAt: string, endingAt?: string): Promise<EnterprisePagedResult> {
  const key = await getAnalyticsKey();
  const q = new URLSearchParams({ starting_at: startingAt, limit: "1000" });
  if (endingAt) q.set("ending_at", endingAt);
  return fetchAllPages(key, "/v1/organizations/analytics/user_cost_report", q);
}

export async function testClaudeEnterprise(): Promise<{ success: boolean; message: string }> {
  if (!(await isClaudeEnterpriseConfigured())) {
    return { success: false, message: "Claude Enterprise Analytics API key is not configured." };
  }
  try {
    const yesterday = isoDay(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const result = await getEnterpriseSummaries(yesterday);
    const summary = result.items.map(parseEnterpriseSummary).find((s) => s !== null);
    if (!summary) return { success: true, message: "Connected. No summary rows yet for yesterday (data lags about a day)." };
    return {
      success: true,
      message: `Connected. ${summary.date}: ${summary.dau ?? "?"} daily / ${summary.wau ?? "?"} weekly / ${summary.mau ?? "?"} monthly active users${summary.seats != null ? `, ${summary.seats} seats` : ""}.`,
    };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Connection failed" };
  }
}
