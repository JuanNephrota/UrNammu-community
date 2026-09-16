import { getSetting } from "./settings";

const BASE_URL = "https://api.openai.com";

export const OPENAI_ADMIN_SETTINGS = {
  ADMIN_KEY: "openai_admin_key",
} as const;

async function getAdminKey(): Promise<string> {
  const key = await getSetting(OPENAI_ADMIN_SETTINGS.ADMIN_KEY);
  if (!key) throw new Error("OpenAI Admin API key not configured. Add it in Settings > Provider Admin APIs.");
  return key;
}

async function adminFetch(path: string): Promise<Record<string, unknown>> {
  const key = await getAdminKey();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(`OpenAI API error (${res.status}): ${err?.error?.message ?? res.statusText}`);
  }
  return res.json();
}

export async function isOpenAIAdminConfigured(): Promise<boolean> {
  return !!(await getSetting(OPENAI_ADMIN_SETTINGS.ADMIN_KEY));
}

export type OpenAIUsageParams = {
  start_time: number; // unix timestamp
  end_time?: number;
  group_by?: string[]; // model, project_id, api_key_id, user_id
  bucket_width?: string; // 1m, 1h, 1d
  limit?: number;
  /** Cursor from a previous response's `next_page`. */
  page?: string;
};

export type OpenAICostsParams = {
  start_time: number;
  end_time?: number;
  bucket_width?: string;
  limit?: number;
  /** Cursor from a previous response's `next_page`. */
  page?: string;
};

/** Get one page of usage data — completions usage grouped by model, project, etc. */
export async function getUsage(params: OpenAIUsageParams) {
  const query = new URLSearchParams();
  query.set("start_time", String(params.start_time));
  if (params.end_time) query.set("end_time", String(params.end_time));
  if (params.group_by) {
    for (const g of params.group_by) query.append("group_by", g);
  }
  if (params.bucket_width) query.set("bucket_width", params.bucket_width);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.page) query.set("page", params.page);
  return adminFetch(`/v1/organization/usage/completions?${query}`);
}

/** Get one page of cost data */
export async function getCosts(params: OpenAICostsParams) {
  const query = new URLSearchParams();
  query.set("start_time", String(params.start_time));
  if (params.end_time) query.set("end_time", String(params.end_time));
  if (params.bucket_width) query.set("bucket_width", params.bucket_width ?? "1d");
  if (params.limit) query.set("limit", String(params.limit));
  if (params.page) query.set("page", params.page);
  return adminFetch(`/v1/organization/costs?${query}`);
}

export const OPENAI_DEFAULT_MAX_PAGES = 20;

export type OpenAIPagedResult = {
  /** Concatenated `data` arrays (time buckets) from every fetched page. */
  data: Record<string, unknown>[];
  /** Number of pages actually fetched. */
  pages: number;
  /** True when `maxPages` was reached while the API still reported `has_more`. */
  truncated: boolean;
};

/**
 * Follow OpenAI's `has_more` / `next_page` cursor pagination. `fetchPage`
 * receives the cursor (undefined for the first page) and must return the raw
 * page envelope `{ object: "page", data: [...], has_more, next_page }`.
 * Pure apart from the injected fetcher, so it is unit-testable offline.
 */
export async function paginateOpenAI(
  fetchPage: (page: string | undefined) => Promise<Record<string, unknown>>,
  options: { maxPages?: number } = {},
): Promise<OpenAIPagedResult> {
  const maxPages = options.maxPages ?? OPENAI_DEFAULT_MAX_PAGES;
  const data: Record<string, unknown>[] = [];
  let page: string | undefined;
  let pages = 0;
  let truncated = false;

  while (pages < maxPages) {
    const envelope = await fetchPage(page);
    pages++;
    const buckets = Array.isArray(envelope.data) ? (envelope.data as Record<string, unknown>[]) : [];
    data.push(...buckets);

    const hasMore = envelope.has_more === true;
    const nextPage = typeof envelope.next_page === "string" && envelope.next_page.length > 0
      ? envelope.next_page
      : undefined;
    if (!hasMore || !nextPage) break;
    if (pages >= maxPages) {
      truncated = true;
      break;
    }
    page = nextPage;
  }

  return { data, pages, truncated };
}

/** Fetch every page of completions usage for the window (page-capped). */
export async function getAllUsage(
  params: Omit<OpenAIUsageParams, "page">,
  options: { maxPages?: number } = {},
): Promise<OpenAIPagedResult> {
  return paginateOpenAI((page) => getUsage({ ...params, page }), options);
}

/** Fetch every page of costs for the window (page-capped). */
export async function getAllCosts(
  params: Omit<OpenAICostsParams, "page">,
  options: { maxPages?: number } = {},
): Promise<OpenAIPagedResult> {
  return paginateOpenAI((page) => getCosts({ ...params, page }), options);
}

/** List assistants (project-scoped) */
export async function listAssistants(params?: { limit?: number; order?: string }) {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.order) query.set("order", params.order);
  const qs = query.toString();
  return adminFetch(`/v1/assistants${qs ? `?${qs}` : ""}`);
}

/** List admin API keys */
export async function listAdminAPIKeys() {
  return adminFetch("/v1/organization/admin_api_keys");
}

/** Test the admin API connection */
export async function testOpenAIAdmin(): Promise<{ success: boolean; message: string }> {
  try {
    // Try fetching costs as a connection test — lightweight endpoint
    const startTime = Math.floor(Date.now() / 1000) - 86400;
    await getCosts({ start_time: startTime, bucket_width: "1d", limit: 1 });
    return {
      success: true,
      message: "Connected to OpenAI organization successfully.",
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

/**
 * Fetch full org data for the oversight dashboard.
 */
export async function fetchOpenAIOrgData() {
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  const now = Math.floor(Date.now() / 1000);

  const [usageByModel, costs, assistants] = await Promise.all([
    getUsage({
      start_time: thirtyDaysAgo,
      end_time: now,
      group_by: ["model"],
      bucket_width: "1d",
    }).catch(() => null),
    getCosts({
      start_time: thirtyDaysAgo,
      end_time: now,
      bucket_width: "1d",
    }).catch(() => null),
    listAssistants({ limit: 100, order: "desc" }).catch(() => null),
  ]);

  return { usageByModel, costs, assistants };
}
