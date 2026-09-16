import { getSetting } from "./settings";

// Cursor Admin API client (Teams/Business/Enterprise). Mirrors the other
// provider-admin clients. Docs: https://cursor.com/docs/account/teams/admin-api
//
// Auth is HTTP Basic with the admin API key as the username and an empty
// password (`-u KEY:`). All endpoints are POST with a JSON body. Analytics
// retention is ~30 days, so the sync must run regularly to build history.

const BASE_URL = "https://api.cursor.com";

export const CURSOR_ADMIN_SETTINGS = {
  ADMIN_KEY: "cursor_admin_key",
} as const;

async function getAdminKey(): Promise<string> {
  const key = await getSetting(CURSOR_ADMIN_SETTINGS.ADMIN_KEY);
  if (!key) {
    throw new Error(
      "Cursor Admin API key not configured. Add it in Settings > Provider Admin APIs.",
    );
  }
  return key;
}

export async function isCursorAdminConfigured(): Promise<boolean> {
  return !!(await getSetting(CURSOR_ADMIN_SETTINGS.ADMIN_KEY));
}

async function adminPost<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const key = await getAdminKey();
  // Basic auth: base64("<key>:") — key as username, empty password.
  const auth = Buffer.from(`${key}:`).toString("base64");
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let msg: string;
    try {
      const err = JSON.parse(text);
      msg = err?.error?.message ?? err?.message ?? text;
    } catch {
      msg = text;
    }
    throw new Error(`Cursor Admin API error (${res.status}): ${msg}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types (subset we consume) ───────────────────────────

export interface CursorDailyUsageRow {
  userId?: number;
  day?: string; // YYYY-MM-DD
  date?: number; // epoch ms
  email?: string;
  isActive?: boolean;
  mostUsedModel?: string;
  composerRequests?: number;
  chatRequests?: number;
  agentRequests?: number;
  cmdkUsages?: number;
  subscriptionIncludedReqs?: number;
  usageBasedReqs?: number;
  apiKeyReqs?: number;
  totalLinesAdded?: number;
  totalLinesDeleted?: number;
  acceptedLinesAdded?: number;
  acceptedLinesDeleted?: number;
  [k: string]: unknown;
}

export interface CursorMemberSpend {
  userId?: number;
  name?: string;
  email?: string;
  role?: string;
  spendCents?: number; // on-demand spend, current cycle
  overallSpendCents?: number; // incl. subscription usage
  fastPremiumRequests?: number;
  hardLimitOverrideDollars?: number;
  monthlyLimitDollars?: number;
  [k: string]: unknown;
}

export interface CursorUsageEvent {
  timestamp?: string; // epoch ms (string)
  userEmail?: string;
  model?: string;
  kind?: string;
  requestsCosts?: number;
  isChargeable?: boolean;
  chargedCents?: number; // total charged (model cost + token rate)
  cursorTokenFee?: number;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
    totalCents?: number;
  };
  [k: string]: unknown;
}

interface Pagination {
  hasNextPage?: boolean;
  totalPages?: number;
  numPages?: number;
  currentPage?: number;
}

// ─── Endpoints ───────────────────────────────────────────

/** Page caps — runaway guards. Hitting one flags the result `truncated`. */
export const CURSOR_DAILY_USAGE_MAX_PAGES = 50;
export const CURSOR_USAGE_EVENTS_MAX_PAGES = 200;
export const CURSOR_PAGE_SIZE = 1000;

export type CursorPagedResult<T> = {
  rows: T[];
  /** Number of pages actually fetched. */
  pages: number;
  /** True when the page cap was reached while the API still reported hasNextPage. */
  truncated: boolean;
};

/** Per-user, per-day activity. start/end are epoch ms. Paginated. */
export async function getCursorDailyUsage(
  startMs: number,
  endMs: number,
): Promise<CursorPagedResult<CursorDailyUsageRow>> {
  const rows: CursorDailyUsageRow[] = [];
  let page = 1;
  let pages = 0;
  let truncated = false;
  for (let i = 0; i < CURSOR_DAILY_USAGE_MAX_PAGES; i++) {
    const res = await adminPost<{
      data?: CursorDailyUsageRow[];
      pagination?: Pagination;
    }>("/teams/daily-usage-data", {
      startDate: startMs,
      endDate: endMs,
      page,
      pageSize: CURSOR_PAGE_SIZE,
    });
    pages++;
    rows.push(...(res.data ?? []));
    if (!res.pagination?.hasNextPage) break;
    if (i === CURSOR_DAILY_USAGE_MAX_PAGES - 1) truncated = true;
    page++;
  }
  return { rows, pages, truncated };
}

/** Current-cycle per-member spend. Returns members + cycle start. */
export async function getCursorSpend(): Promise<{
  members: CursorMemberSpend[];
  cycleStartMs: number | null;
}> {
  const members: CursorMemberSpend[] = [];
  let cycleStartMs: number | null = null;
  let page = 1;
  for (let i = 0; i < 50; i++) {
    const res = await adminPost<{
      teamMemberSpend?: CursorMemberSpend[];
      subscriptionCycleStart?: number;
      totalPages?: number;
    }>("/teams/spend", { page, pageSize: 100 });
    members.push(...(res.teamMemberSpend ?? []));
    if (cycleStartMs == null && typeof res.subscriptionCycleStart === "number") {
      cycleStartMs = res.subscriptionCycleStart;
    }
    const totalPages = res.totalPages ?? 1;
    if (page >= totalPages) break;
    page++;
  }
  return { members, cycleStartMs };
}

/** Lightweight connectivity/auth check for the Settings "Test" button. */
export async function testCursorAdmin(): Promise<{ success: boolean; message: string }> {
  try {
    // Smallest reasonable call: one page of current-cycle spend.
    const { members } = await getCursorSpend();
    return {
      success: true,
      message: `Connected to Cursor team (${members.length} member${members.length === 1 ? "" : "s"} visible).`,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

/** Granular per-event usage incl. chargedCents + token counts. Paginated. */
export async function getCursorUsageEvents(
  startMs: number,
  endMs: number,
): Promise<CursorPagedResult<CursorUsageEvent>> {
  const rows: CursorUsageEvent[] = [];
  let page = 1;
  let pages = 0;
  let truncated = false;
  // Cap pages — events can be voluminous; the sync window keeps this bounded
  // and the cap is reported back so the sync run can record truncation.
  for (let i = 0; i < CURSOR_USAGE_EVENTS_MAX_PAGES; i++) {
    const res = await adminPost<{
      usageEvents?: CursorUsageEvent[];
      pagination?: Pagination;
    }>("/teams/filtered-usage-events", {
      startDate: startMs,
      endDate: endMs,
      page,
      pageSize: CURSOR_PAGE_SIZE,
    });
    pages++;
    rows.push(...(res.usageEvents ?? []));
    if (!res.pagination?.hasNextPage) break;
    if (i === CURSOR_USAGE_EVENTS_MAX_PAGES - 1) truncated = true;
    page++;
  }
  return { rows, pages, truncated };
}
