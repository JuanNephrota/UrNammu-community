import { getSetting } from "./settings";

const BASE_URL = "https://api.anthropic.com";

export const ANTHROPIC_ADMIN_SETTINGS = {
  ADMIN_KEY: "anthropic_admin_key",
} as const;

async function getAdminKey(): Promise<string> {
  const key = await getSetting(ANTHROPIC_ADMIN_SETTINGS.ADMIN_KEY);
  if (!key) throw new Error("Anthropic Admin API key not configured. Add it in Settings > Provider Admin APIs.");
  return key;
}

export async function adminFetch(path: string): Promise<Record<string, unknown>> {
  const key = await getAdminKey();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let errMsg: string;
    try {
      const err = JSON.parse(text);
      errMsg = err?.error?.message ?? err?.message ?? text;
    } catch {
      errMsg = text;
    }
    throw new Error(`Anthropic API error (${res.status}): ${errMsg}`);
  }
  return res.json();
}

export async function isAnthropicAdminConfigured(): Promise<boolean> {
  return !!(await getSetting(ANTHROPIC_ADMIN_SETTINGS.ADMIN_KEY));
}

/** Get organization info */
export async function getOrganization() {
  return adminFetch("/v1/organizations/me");
}

/** List all API keys in the organization */
export async function listAPIKeys(params?: { status?: string; limit?: number; after_id?: string }) {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.after_id) query.set("after_id", params.after_id);
  const qs = query.toString();
  return adminFetch(`/v1/organizations/api_keys${qs ? `?${qs}` : ""}`);
}

/** List organization members */
export async function listMembers(params?: { limit?: number; after_id?: string }) {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.after_id) query.set("after_id", params.after_id);
  const qs = query.toString();
  return adminFetch(`/v1/organizations/users${qs ? `?${qs}` : ""}`);
}

/**
 * List organization workspaces. Workspaces are the Anthropic Console's
 * spend/isolation boundary: every API key belongs to exactly one workspace
 * (or the org's default workspace, which the reports return as
 * `workspace_id: null`). Items: { id, name, archived_at, display_color, ... }.
 */
export async function listWorkspaces(params?: { limit?: number; include_archived?: boolean }) {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.include_archived) query.set("include_archived", "true");
  const qs = query.toString();
  return adminFetch(`/v1/organizations/workspaces${qs ? `?${qs}` : ""}`);
}

export const ANTHROPIC_DEFAULT_MAX_PAGES = 20;
/** Max `limit` for list endpoints (api_keys, users). */
export const ANTHROPIC_LIST_PAGE_SIZE = 100;
/** Max `limit` (1d buckets) for usage_report / cost_report. */
export const ANTHROPIC_REPORT_PAGE_SIZE = 31;

export type AnthropicPagedResult = {
  /** Concatenated `data` arrays from every fetched page. */
  data: Record<string, unknown>[];
  /** Number of pages actually fetched. */
  pages: number;
  /** True when `maxPages` was reached while the API still reported `has_more`. */
  truncated: boolean;
};

/**
 * Follow Anthropic Admin API pagination. Two cursor styles exist:
 *   - list endpoints (api_keys, users): `has_more` + `last_id`, next request
 *     passes `after_id=<last_id>`;
 *   - report endpoints (usage_report, cost_report): `has_more` + `next_page`,
 *     next request passes `page=<next_page>`.
 * `fetchPage` receives the cursor (undefined for the first page) and returns
 * the raw envelope. Pure apart from the injected fetcher.
 */
export async function paginateAnthropic(
  fetchPage: (cursor: string | undefined) => Promise<Record<string, unknown>>,
  options: { maxPages?: number; cursorField?: "last_id" | "next_page" } = {},
): Promise<AnthropicPagedResult> {
  const maxPages = options.maxPages ?? ANTHROPIC_DEFAULT_MAX_PAGES;
  const cursorField = options.cursorField ?? "next_page";
  const data: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  let pages = 0;
  let truncated = false;

  while (pages < maxPages) {
    const envelope = await fetchPage(cursor);
    pages++;
    const items = Array.isArray(envelope.data) ? (envelope.data as Record<string, unknown>[]) : [];
    data.push(...items);

    const hasMore = envelope.has_more === true;
    const rawCursor = envelope[cursorField];
    const nextCursor = typeof rawCursor === "string" && rawCursor.length > 0 ? rawCursor : undefined;
    if (!hasMore || !nextCursor) break;
    if (pages >= maxPages) {
      truncated = true;
      break;
    }
    cursor = nextCursor;
  }

  return { data, pages, truncated };
}

/** Every API key in the organization (page-capped). */
export async function listAllAPIKeys(
  params?: { status?: string },
  options: { maxPages?: number } = {},
): Promise<AnthropicPagedResult> {
  return paginateAnthropic(
    (cursor) => listAPIKeys({ status: params?.status, limit: ANTHROPIC_LIST_PAGE_SIZE, after_id: cursor }),
    { ...options, cursorField: "last_id" },
  );
}

/** Every organization member (page-capped). */
export async function listAllMembers(options: { maxPages?: number } = {}): Promise<AnthropicPagedResult> {
  return paginateAnthropic(
    (cursor) => listMembers({ limit: ANTHROPIC_LIST_PAGE_SIZE, after_id: cursor }),
    { ...options, cursorField: "last_id" },
  );
}

/**
 * Get usage report — tokens by model / workspace / API key.
 *
 * Supported `group_by[]` values: `api_key_id`, `workspace_id`, `model`,
 * `service_tier`, `context_window`. Fields not requested in `group_by` come
 * back as null on every result row, so ask for every dimension you intend to
 * store.
 */
export type AnthropicReportParams = {
  starting_at: string; // ISO 8601 timestamp, e.g. 2025-01-08T00:00:00Z
  ending_at: string;
  group_by?: string[]; // api_key_id, workspace_id, model, service_tier, context_window
  bucket_width?: string; // 1m, 1h, 1d (default 1d)
  /** Max buckets per page (default 7, max 31 for 1d). */
  limit?: number;
  /** Cursor from a previous response's `next_page`. */
  page?: string;
};

export async function getUsageReport(params: AnthropicReportParams) {
  const query = new URLSearchParams();
  query.set("starting_at", params.starting_at);
  query.set("ending_at", params.ending_at);
  query.set("bucket_width", params.bucket_width ?? "1d");
  if (params.limit) query.set("limit", String(params.limit));
  if (params.page) query.set("page", params.page);
  if (params.group_by) {
    for (const g of params.group_by) query.append("group_by[]", g);
  }
  return adminFetch(`/v1/organizations/usage_report/messages?${query}`);
}

/**
 * Every page of the usage report for the window (page-capped). The report
 * defaults to 7 one-day buckets per page, so any window longer than a week
 * must follow `has_more` / `next_page` or it is silently cut off.
 */
export async function getAllUsageReport(
  params: Omit<AnthropicReportParams, "page">,
  options: { maxPages?: number } = {},
): Promise<AnthropicPagedResult> {
  return paginateAnthropic(
    (cursor) => getUsageReport({ ...params, limit: params.limit ?? ANTHROPIC_REPORT_PAGE_SIZE, page: cursor }),
    { ...options, cursorField: "next_page" },
  );
}

/**
 * Get cost report — costs (in cents) by workspace / description.
 *
 * Supported `group_by[]` values: `workspace_id`, `description`. The cost
 * report cannot be grouped by API key, so per-key cost for Anthropic is only
 * available at workspace granularity.
 */
export async function getCostReport(params: AnthropicReportParams) {
  const query = new URLSearchParams();
  query.set("starting_at", params.starting_at);
  query.set("ending_at", params.ending_at);
  query.set("bucket_width", params.bucket_width ?? "1d");
  if (params.limit) query.set("limit", String(params.limit));
  if (params.page) query.set("page", params.page);
  if (params.group_by) {
    for (const g of params.group_by) query.append("group_by[]", g);
  }
  return adminFetch(`/v1/organizations/cost_report?${query}`);
}

/** Every page of the cost report for the window (page-capped). */
export async function getAllCostReport(
  params: Omit<AnthropicReportParams, "page">,
  options: { maxPages?: number } = {},
): Promise<AnthropicPagedResult> {
  return paginateAnthropic(
    (cursor) => getCostReport({ ...params, limit: params.limit ?? ANTHROPIC_REPORT_PAGE_SIZE, page: cursor }),
    { ...options, cursorField: "next_page" },
  );
}

/** Test the admin API connection */
export async function testAnthropicAdmin(): Promise<{ success: boolean; message: string; org?: string }> {
  try {
    const org = await getOrganization();
    return {
      success: true,
      message: `Connected to organization: ${(org as Record<string, unknown>).name ?? "Unknown"}`,
      org: (org as Record<string, unknown>).name as string,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

/**
 * Fetch full usage + API key + member data for the oversight dashboard.
 */
export async function fetchAnthropicOrgData() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const today = new Date();
  const startingAt = thirtyDaysAgo.toISOString();
  const endingAt = today.toISOString();

  const [org, keys, members, usageByModel, usageByKey] = await Promise.all([
    getOrganization().catch(() => null),
    listAPIKeys({ status: "active", limit: 100 }).catch(() => null),
    listMembers({ limit: 100 }).catch(() => null),
    getUsageReport({ starting_at: startingAt, ending_at: endingAt, group_by: ["model"] }).catch(() => null),
    getUsageReport({ starting_at: startingAt, ending_at: endingAt, group_by: ["api_key_id"] }).catch(() => null),
  ]);

  return { org, keys, members, usageByModel, usageByKey };
}
