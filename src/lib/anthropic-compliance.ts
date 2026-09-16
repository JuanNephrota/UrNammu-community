import { getSetting } from "./settings";
import { ANTHROPIC_ADMIN_SETTINGS } from "./anthropic-admin";

// ─── Anthropic Compliance API ──────────────────────────────────────────────
// Activity Feed + session metadata for the Claude Enterprise organization.
//
// Reference (verified 2026-09-16):
//   GET https://api.anthropic.com/v1/compliance/activities
//     headers: x-api-key, anthropic-version: 2023-06-01
//     works with an Admin API key (sk-ant-admin01-…, feed only) or a Compliance
//     Access Key (sk-ant-api01-…, scope read:compliance_activities)
//     newest first; cursor `after_id` = previous page's `last_id`; `has_more`;
//     `limit` ≤ 5000; filters activity_types[], actor_ids[], created_at.gte/.lt
//     actor union: user_actor / api_actor / admin_api_key_actor /
//     unauthenticated_user_actor / scim_directory_sync_actor with
//     email_address, user_id, api_key_id, ip_address, user_agent
//   GET /v1/compliance/apps/sessions/local and /remote (Enterprise only,
//     scope read:compliance_user_data): metadata only — product_surface,
//     user.email_address, workspace_id, created_at, updated_at; page/next_page;
//     updated_at.gte filter on /local. Transcripts are never pulled.
//
// Everything that does not need the network (parsing, cursor planning, alert
// evaluation, business-hours maths) is a pure function so it can be unit
// tested; the Prisma writes live in provider-telemetry.ts.

export const ANTHROPIC_COMPLIANCE_SETTINGS = {
  /** Compliance Access Key (sk-ant-api01-…) or Admin key (feed only). */
  COMPLIANCE_KEY: "anthropic_compliance_key",
  /** IANA timezone used for "outside business hours" alerts. Default UTC. */
  ORG_TIMEZONE: "org_timezone",
  /** How far back the first feed pull reaches. Default 30 days. */
  LOOKBACK_DAYS: "anthropic_compliance_lookback_days",
} as const;

export const ANTHROPIC_COMPLIANCE_PROVIDER = "anthropic_compliance";
/** `ComplianceActivity.provider` / `ComplianceSession.provider` value. */
export const COMPLIANCE_RECORD_PROVIDER = "anthropic";
/** `Alert.source` for everything this module raises. */
export const COMPLIANCE_ALERT_SOURCE = "anthropic_compliance";

const BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

export const COMPLIANCE_FEED_PAGE_LIMIT = 1000;
export const COMPLIANCE_FEED_MAX_PAGES = 20;
export const COMPLIANCE_FEED_DEFAULT_LOOKBACK_DAYS = 30;
/** Re-pull this much before the watermark; upserts by id make it free. */
export const COMPLIANCE_FEED_OVERLAP_MS = 6 * 60 * 60 * 1000;
export const COMPLIANCE_SESSIONS_MAX_PAGES = 20;
export const BUSINESS_HOURS = { start: 7, end: 19 } as const;
/** Alerts are only raised for activities this recent on the first run. */
export const COMPLIANCE_FIRST_RUN_ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;

// ── Key resolution ────────────────────────────────────────────────────────

export type ComplianceKeyKind = "compliance" | "admin";

/**
 * The Activity Feed accepts either key type; sessions need a Compliance
 * Access Key. Prefer the dedicated key, fall back to the Admin key so the
 * feed works for orgs that only configured Provider Admin APIs.
 */
export async function resolveComplianceKey(): Promise<{ key: string; kind: ComplianceKeyKind } | null> {
  const dedicated = await getSetting(ANTHROPIC_COMPLIANCE_SETTINGS.COMPLIANCE_KEY);
  if (dedicated) return { key: dedicated, kind: "compliance" };
  const admin = await getSetting(ANTHROPIC_ADMIN_SETTINGS.ADMIN_KEY);
  if (admin) return { key: admin, kind: "admin" };
  return null;
}

export async function isAnthropicComplianceConfigured(): Promise<boolean> {
  return (await resolveComplianceKey()) !== null;
}

export async function getOrgTimezone(): Promise<string> {
  const tz = await getSetting(ANTHROPIC_COMPLIANCE_SETTINGS.ORG_TIMEZONE);
  return tz && isValidTimeZone(tz) ? tz : "UTC";
}

// ── HTTP ──────────────────────────────────────────────────────────────────

export class ComplianceApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ComplianceApiError";
  }
}

async function complianceFetch(path: string, key: string): Promise<unknown> {
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
      /* plain text body */
    }
    throw new ComplianceApiError(`Anthropic Compliance API error (${res.status}): ${message}`, res.status);
  }
  return res.json();
}

// ── Generic value helpers ─────────────────────────────────────────────────

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = str(source[key]);
    if (value) return value;
  }
  return null;
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number" && Number.isFinite(v)) {
    // Seconds vs milliseconds: anything before 1e12 is seconds.
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "string" && v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// ── Actor + activity parsing ──────────────────────────────────────────────

export const COMPLIANCE_ACTOR_TYPES = [
  "user_actor",
  "api_actor",
  "admin_api_key_actor",
  "unauthenticated_user_actor",
  "scim_directory_sync_actor",
] as const;

export interface ComplianceActor {
  type: string;
  email: string | null;
  userId: string | null;
  apiKeyId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  /** ISO 3166-1 alpha-2 when present upstream; null when not derivable. */
  country: string | null;
}

const COUNTRY_KEYS = ["ip_country", "country_code", "country", "countryCode", "geo_country"];

/**
 * Best-effort country lookup. UrNammu does not bundle a GeoIP database, so
 * the country is only known when the upstream record carries one (on the
 * actor, in a `location` / `geo` sub-object, or at the top level).
 */
export function deriveCountry(...sources: unknown[]): string | null {
  for (const source of sources) {
    const r = rec(source);
    const direct = firstString(r, COUNTRY_KEYS);
    const nested =
      direct ??
      firstString(rec(r.location), COUNTRY_KEYS) ??
      firstString(rec(r.geo), COUNTRY_KEYS) ??
      firstString(rec(r.geolocation), COUNTRY_KEYS);
    if (nested) {
      const trimmed = nested.trim();
      return /^[A-Za-z]{2}$/.test(trimmed) ? trimmed.toUpperCase() : trimmed;
    }
  }
  return null;
}

export function parseComplianceActor(raw: unknown): ComplianceActor {
  const a = rec(raw);
  const type = str(a.type) ?? "unknown";
  return {
    type,
    email: firstString(a, ["email_address", "email"])?.toLowerCase() ?? null,
    userId: firstString(a, ["user_id", "id"]),
    apiKeyId: firstString(a, ["api_key_id", "admin_api_key_id", "key_id"]),
    ipAddress: firstString(a, ["ip_address", "ip"]),
    userAgent: firstString(a, ["user_agent"]),
    country: deriveCountry(a),
  };
}

export interface NormalizedComplianceActivity {
  id: string;
  type: string;
  occurredAt: Date;
  organizationId: string | null;
  actorType: string;
  actorEmail: string | null;
  actorUserId: string | null;
  actorApiKeyId: string | null;
  ipAddress: string | null;
  ipCountry: string | null;
  userAgent: string | null;
  payload: Record<string, unknown>;
}

/**
 * Map one feed item onto the ComplianceActivity columns. Returns null when
 * the item has no id or no timestamp (nothing to key or order it by). The
 * upstream type field is stored verbatim; `type` on the envelope is usually
 * the literal "activity", so the specific field wins when present.
 */
export function normalizeComplianceActivity(raw: unknown): NormalizedComplianceActivity | null {
  const r = rec(raw);
  const id = str(r.id);
  const occurredAt = toDate(r.created_at ?? r.occurred_at ?? r.timestamp);
  if (!id || !occurredAt) return null;
  const type =
    firstString(r, ["activity_type", "event_type", "action"]) ??
    (str(r.type) && str(r.type) !== "activity" ? (str(r.type) as string) : null) ??
    "unknown";
  const actor = parseComplianceActor(r.actor);
  return {
    id,
    type,
    occurredAt,
    organizationId: firstString(r, ["organization_id", "org_id"]),
    actorType: actor.type,
    actorEmail: actor.email,
    actorUserId: actor.userId,
    actorApiKeyId: actor.apiKeyId,
    ipAddress: actor.ipAddress,
    ipCountry: actor.country ?? deriveCountry(r),
    userAgent: actor.userAgent,
    payload: r,
  };
}

export type ComplianceActivityClass =
  | "api_key_created"
  | "api_key_lifecycle"
  | "compliance_api_accessed"
  | "login"
  | "other";

/** Coarse class for the governance rules; tolerant of naming variants. */
export function classifyComplianceActivity(type: string): ComplianceActivityClass {
  const t = type.toLowerCase();
  if (t.includes("compliance") && (t.includes("access") || t.includes("read") || t.includes("export"))) {
    return "compliance_api_accessed";
  }
  if (t.includes("api_key") || t.includes("apikey") || t.includes("api-key")) {
    if (t.includes("creat") || t.includes("generat") || t.includes("issued")) return "api_key_created";
    return "api_key_lifecycle";
  }
  if (t.includes("login") || t.includes("logged_in") || t.includes("sign_in") || t.includes("signin") || t.includes("session_started")) {
    return "login";
  }
  return "other";
}

/** The API key an `api_key_created` activity refers to, wherever it lives. */
export function extractCreatedApiKey(payload: Record<string, unknown>): { id: string | null; name: string | null } {
  const candidates = [rec(payload.api_key), rec(payload.target), rec(payload.resource), rec(payload.metadata), rec(payload.details), payload];
  let id: string | null = null;
  let name: string | null = null;
  for (const c of candidates) {
    id = id ?? firstString(c, ["api_key_id", "key_id"]) ?? (c !== payload ? firstString(c, ["id"]) : null);
    name = name ?? firstString(c, ["api_key_name", "key_name", "name"]);
  }
  return { id, name };
}

// ── Feed pages ────────────────────────────────────────────────────────────

export interface ComplianceFeedPage {
  items: unknown[];
  hasMore: boolean;
  firstId: string | null;
  lastId: string | null;
}

export function parseComplianceFeedPage(body: unknown): ComplianceFeedPage {
  const r = rec(body);
  const items = Array.isArray(r.data) ? r.data : Array.isArray(r.activities) ? r.activities : [];
  const last = items.length ? rec(items[items.length - 1]) : {};
  const first = items.length ? rec(items[0]) : {};
  return {
    items,
    hasMore: r.has_more === true,
    firstId: str(r.first_id) ?? str(first.id),
    lastId: str(r.last_id) ?? str(last.id),
  };
}

export interface ComplianceFeedFetchParams {
  afterId?: string | null;
  createdAtGte?: Date | null;
  createdAtLt?: Date | null;
  limit?: number;
  activityTypes?: string[];
}

export function buildComplianceFeedQuery(params: ComplianceFeedFetchParams): string {
  const q = new URLSearchParams();
  q.set("limit", String(Math.min(Math.max(params.limit ?? COMPLIANCE_FEED_PAGE_LIMIT, 1), 5000)));
  if (params.afterId) q.set("after_id", params.afterId);
  if (params.createdAtGte) q.set("created_at.gte", params.createdAtGte.toISOString());
  if (params.createdAtLt) q.set("created_at.lt", params.createdAtLt.toISOString());
  for (const t of params.activityTypes ?? []) q.append("activity_types[]", t);
  return q.toString();
}

export async function fetchComplianceActivities(key: string, params: ComplianceFeedFetchParams): Promise<ComplianceFeedPage> {
  const body = await complianceFetch(`/v1/compliance/activities?${buildComplianceFeedQuery(params)}`, key);
  return parseComplianceFeedPage(body);
}

// ── Cursor / watermark planning ───────────────────────────────────────────

export interface ComplianceWatermarkState {
  /** Newest `created_at` fully ingested. */
  watermark: Date;
  /** Oldest `created_at` ever ingested. */
  earliest: Date;
  /** `last_id` of a backfill page that still had `has_more`; null when drained. */
  cursor: string | null;
}

export interface ComplianceFeedPlan {
  /** True when no watermark exists yet (baseline-learning run). */
  firstRun: boolean;
  /** `created_at.gte` for the newest-first incremental pull. */
  incrementalSince: Date;
  /**
   * Continue an earlier backfill that hit the page cap: page with
   * `after_id = cursor` down to `since` (the lookback floor).
   */
  backfill: { afterId: string; since: Date } | null;
}

/**
 * The feed is newest-first, so an incremental pull cannot "continue" from a
 * cursor — it re-reads everything newer than the watermark (minus an
 * overlap) and stops when the pages run out. A backfill that was cut short
 * is resumed separately from its stored cursor.
 */
export function planComplianceFeedPull(input: {
  state: ComplianceWatermarkState | null;
  now: Date;
  lookbackDays?: number;
  overlapMs?: number;
}): ComplianceFeedPlan {
  const lookbackDays = input.lookbackDays ?? COMPLIANCE_FEED_DEFAULT_LOOKBACK_DAYS;
  const overlapMs = input.overlapMs ?? COMPLIANCE_FEED_OVERLAP_MS;
  const floor = new Date(input.now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  if (!input.state) {
    return { firstRun: true, incrementalSince: floor, backfill: null };
  }
  const since = new Date(Math.max(input.state.watermark.getTime() - overlapMs, floor.getTime()));
  return {
    firstRun: false,
    incrementalSince: since,
    backfill: input.state.cursor ? { afterId: input.state.cursor, since: floor } : null,
  };
}

/**
 * Fold a run's results into the watermark. The watermark only moves forward
 * and `earliest` only moves back; the cursor is whatever the backfill left
 * (null when it drained or when nothing was truncated).
 */
export function advanceComplianceWatermark(
  prev: ComplianceWatermarkState | null,
  activities: { occurredAt: Date }[],
  remainingCursor: string | null,
): ComplianceWatermarkState | null {
  if (activities.length === 0) {
    return prev ? { ...prev, cursor: remainingCursor } : null;
  }
  let newest = activities[0].occurredAt.getTime();
  let oldest = newest;
  for (const a of activities) {
    const t = a.occurredAt.getTime();
    if (t > newest) newest = t;
    if (t < oldest) oldest = t;
  }
  return {
    watermark: new Date(Math.max(newest, prev?.watermark.getTime() ?? 0)),
    earliest: new Date(Math.min(oldest, prev?.earliest.getTime() ?? Number.POSITIVE_INFINITY)),
    cursor: remainingCursor,
  };
}

// ── Business hours ────────────────────────────────────────────────────────

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Hour of day (0–23) at `date` in the given IANA timezone; UTC on a bad tz. */
export function localHour(date: Date, timeZone: string): number {
  const tz = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  // Some ICU builds render midnight as "24".
  return Number.isFinite(hour) ? hour % 24 : 0;
}

export function isOutsideBusinessHours(
  date: Date,
  timeZone: string,
  hours: { start: number; end: number } = BUSINESS_HOURS,
): boolean {
  const h = localHour(date, timeZone);
  return h < hours.start || h >= hours.end;
}

// ── Alert evaluation ──────────────────────────────────────────────────────

export type ComplianceAlertSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface ComplianceAlertCandidate {
  /** Stable rule key, stored in the alert description for filtering. */
  rule: "api_key_created_unknown_actor" | "api_key_created_off_hours" | "compliance_api_unknown_key" | "login_new_country";
  activityId: string;
  activityType: string;
  occurredAt: Date;
  title: string;
  description: string;
  severity: ComplianceAlertSeverity;
}

export interface ComplianceAlertContext {
  /** Lower-cased emails UrNammu already knows (Users, Anthropic org members, prior feed actors). */
  knownActorEmails: Set<string>;
  /** `api_key_id`s that have accessed the Compliance API before this run. */
  knownComplianceKeyIds: Set<string>;
  /** Per lower-cased email: countries seen on earlier login activities. */
  knownLoginCountries: Map<string, Set<string>>;
  timeZone: string;
  /**
   * First run against an org: the baseline sets are empty, so "unknown"
   * rules would fire for everything. They are suppressed; the off-hours rule
   * still applies to activities inside `firstRunAlertWindowMs` of `now`.
   */
  firstRun: boolean;
  now: Date;
  firstRunAlertWindowMs?: number;
}

function fmtWhen(date: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: isValidTimeZone(tz) ? tz : "UTC",
      dateStyle: "medium",
      timeStyle: "short",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/**
 * Governance rules over newly ingested activities. Pure: the caller supplies
 * the baseline sets from the database and creates alerts for the result.
 *   - api_key_created by an actor UrNammu has never seen              → HIGH
 *   - api_key_created outside 07:00–19:00 org-local                   → MEDIUM
 *   - compliance_api_accessed from an api_key_id never seen before    → HIGH
 *   - login from a country not seen for that person (when derivable)  → MEDIUM
 */
export function evaluateComplianceAlerts(
  activities: NormalizedComplianceActivity[],
  ctx: ComplianceAlertContext,
): ComplianceAlertCandidate[] {
  const out: ComplianceAlertCandidate[] = [];
  const windowMs = ctx.firstRunAlertWindowMs ?? COMPLIANCE_FIRST_RUN_ALERT_WINDOW_MS;
  // Learn within the batch too, so two logins from the same new country in
  // one pull produce one alert, and a key that accessed the Compliance API
  // twice in one pull produces one alert.
  const seenKeys = new Set(ctx.knownComplianceKeyIds);
  const seenCountries = new Map<string, Set<string>>();
  for (const [email, set] of ctx.knownLoginCountries) seenCountries.set(email, new Set(set));

  const ordered = [...activities].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  for (const a of ordered) {
    const cls = classifyComplianceActivity(a.type);
    const recent = ctx.now.getTime() - a.occurredAt.getTime() <= windowMs;
    const who = a.actorEmail ?? (a.actorApiKeyId ? `API key ${a.actorApiKeyId}` : a.actorType);

    if (cls === "api_key_created") {
      const created = extractCreatedApiKey(a.payload);
      const keyLabel = created.name ?? created.id ?? "an API key";
      const unknownActor =
        !ctx.firstRun && a.actorType === "user_actor" && (!a.actorEmail || !ctx.knownActorEmails.has(a.actorEmail));
      const offHours = (!ctx.firstRun || recent) && isOutsideBusinessHours(a.occurredAt, ctx.timeZone);
      if (unknownActor) {
        out.push({
          rule: "api_key_created_unknown_actor",
          activityId: a.id,
          activityType: a.type,
          occurredAt: a.occurredAt,
          severity: "HIGH",
          title: `Anthropic API key created by unknown actor: ${who}`,
          description: [
            `${who} created ${keyLabel} at ${fmtWhen(a.occurredAt, ctx.timeZone)} and is not a registered UrNammu user or a synced Anthropic organization member.`,
            a.ipAddress ? `IP ${a.ipAddress}${a.ipCountry ? ` (${a.ipCountry})` : ""}.` : null,
            `Activity ${a.id} (${a.type}).`,
          ].filter(Boolean).join(" "),
        });
      }
      if (offHours) {
        out.push({
          rule: "api_key_created_off_hours",
          activityId: a.id,
          activityType: a.type,
          occurredAt: a.occurredAt,
          severity: "MEDIUM",
          title: `Anthropic API key created outside business hours: ${keyLabel}`,
          description: [
            `${who} created ${keyLabel} at ${fmtWhen(a.occurredAt, ctx.timeZone)}, outside ${String(BUSINESS_HOURS.start).padStart(2, "0")}:00–${String(BUSINESS_HOURS.end).padStart(2, "0")}:00 ${ctx.timeZone}.`,
            a.ipAddress ? `IP ${a.ipAddress}${a.ipCountry ? ` (${a.ipCountry})` : ""}.` : null,
            `Activity ${a.id} (${a.type}).`,
          ].filter(Boolean).join(" "),
        });
      }
      continue;
    }

    if (cls === "compliance_api_accessed") {
      const keyId = a.actorApiKeyId;
      if (!keyId) continue;
      const known = seenKeys.has(keyId);
      seenKeys.add(keyId);
      if (known || ctx.firstRun) continue;
      out.push({
        rule: "compliance_api_unknown_key",
        activityId: a.id,
        activityType: a.type,
        occurredAt: a.occurredAt,
        severity: "HIGH",
        title: `Compliance API accessed by a new key: ${keyId}`,
        description: [
          `API key ${keyId} read the Anthropic Compliance API at ${fmtWhen(a.occurredAt, ctx.timeZone)} and had not been seen doing so before. The Compliance API exposes every user's activity and session metadata.`,
          a.ipAddress ? `IP ${a.ipAddress}${a.ipCountry ? ` (${a.ipCountry})` : ""}.` : null,
          `Activity ${a.id} (${a.type}).`,
        ].filter(Boolean).join(" "),
      });
      continue;
    }

    if (cls === "login") {
      if (!a.actorEmail || !a.ipCountry) continue;
      let countries = seenCountries.get(a.actorEmail);
      if (!countries) {
        countries = new Set();
        seenCountries.set(a.actorEmail, countries);
      }
      const isNew = countries.size > 0 && !countries.has(a.ipCountry);
      const firstEver = countries.size === 0;
      countries.add(a.ipCountry);
      // A person's very first recorded country is the baseline, not a signal.
      if (ctx.firstRun || firstEver || !isNew) continue;
      out.push({
        rule: "login_new_country",
        activityId: a.id,
        activityType: a.type,
        occurredAt: a.occurredAt,
        severity: "MEDIUM",
        title: `Claude login from a new country: ${a.actorEmail} (${a.ipCountry})`,
        description: [
          `${a.actorEmail} signed in from ${a.ipCountry} at ${fmtWhen(a.occurredAt, ctx.timeZone)}; previous logins came from ${[...countries].filter((c) => c !== a.ipCountry).join(", ")}.`,
          a.ipAddress ? `IP ${a.ipAddress}.` : null,
          a.userAgent ? `User agent: ${a.userAgent.slice(0, 120)}.` : null,
          `Activity ${a.id} (${a.type}).`,
        ].filter(Boolean).join(" "),
      });
    }
  }
  return out;
}

// ── Sessions ──────────────────────────────────────────────────────────────

export type ComplianceSessionKind = "local" | "remote";

export interface NormalizedComplianceSession {
  id: string;
  sessionKind: ComplianceSessionKind;
  productSurface: string | null;
  userEmail: string | null;
  userExternalId: string | null;
  workspaceId: string | null;
  startedAt: Date | null;
  lastActivityAt: Date | null;
  status: string | null;
  raw: Record<string, unknown>;
}

/**
 * Metadata only. Anything that looks like content (messages, transcript,
 * turns, tool calls) is stripped before the record is stored, so a future
 * change to the upstream payload cannot land transcripts in the database.
 */
export function normalizeComplianceSession(raw: unknown, kind: ComplianceSessionKind): NormalizedComplianceSession | null {
  const r = rec(raw);
  const id = str(r.id) ?? str(r.session_id);
  if (!id) return null;
  const user = rec(r.user);
  const stripped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (/^(messages|transcript|turns|events|content|tool_calls|conversation|history)$/i.test(k)) continue;
    stripped[k] = v;
  }
  return {
    id,
    sessionKind: kind,
    productSurface: firstString(r, ["product_surface", "surface", "product"]),
    userEmail: firstString(user, ["email_address", "email"])?.toLowerCase() ?? firstString(r, ["user_email"])?.toLowerCase() ?? null,
    userExternalId: firstString(user, ["user_id", "id"]) ?? firstString(r, ["user_id"]),
    workspaceId: firstString(r, ["workspace_id"]),
    startedAt: toDate(r.created_at ?? r.started_at),
    lastActivityAt: toDate(r.updated_at ?? r.last_activity_at ?? r.created_at),
    status: firstString(r, ["status", "state"]),
    raw: stripped,
  };
}

export interface ComplianceSessionsPage {
  items: unknown[];
  nextPage: string | null;
}

export function parseComplianceSessionsPage(body: unknown): ComplianceSessionsPage {
  const r = rec(body);
  const items = Array.isArray(r.data) ? r.data : Array.isArray(r.sessions) ? r.sessions : [];
  const nextPage = r.has_more === false ? null : str(r.next_page);
  return { items, nextPage };
}

export async function fetchComplianceSessions(
  key: string,
  kind: ComplianceSessionKind,
  params: { page?: string | null; updatedAtGte?: Date | null; limit?: number },
): Promise<ComplianceSessionsPage> {
  const q = new URLSearchParams();
  if (params.limit) q.set("limit", String(params.limit));
  if (params.page) q.set("page", params.page);
  // Only the local endpoint documents the updated_at filter.
  if (kind === "local" && params.updatedAtGte) q.set("updated_at.gte", params.updatedAtGte.toISOString());
  const qs = q.toString();
  const body = await complianceFetch(`/v1/compliance/apps/sessions/${kind}${qs ? `?${qs}` : ""}`, key);
  return parseComplianceSessionsPage(body);
}

// ── Connection test ───────────────────────────────────────────────────────

export async function testAnthropicCompliance(): Promise<{ success: boolean; message: string }> {
  const resolved = await resolveComplianceKey();
  if (!resolved) {
    return { success: false, message: "No Compliance Access Key or Admin API key is configured." };
  }
  try {
    const page = await fetchComplianceActivities(resolved.key, { limit: 1 });
    const keyNote = resolved.kind === "admin" ? " (using the Admin API key — session metadata needs a Compliance Access Key)" : "";
    return {
      success: true,
      message: page.items.length
        ? `Activity Feed reachable; newest activity ${normalizeComplianceActivity(page.items[0])?.occurredAt.toISOString() ?? "unknown"}${keyNote}.`
        : `Activity Feed reachable but empty${keyNote}.`,
    };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Connection failed" };
  }
}
