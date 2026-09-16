import { getSetting } from "./settings";

const DEFAULT_BASE_URL = "https://api.portkey.ai/v1";

export const PORTKEY_SETTINGS = {
  API_KEY: "portkey_api_key",
  API_BASE_URL: "portkey_api_base_url",
  WORKSPACE_SLUG: "portkey_workspace_slug",
} as const;

export type PortkeyGroupedRow = {
  label: string | null;
  requests: number;
  /** Raw Portkey cost figure — in cents. Convert with `portkeyCostToUsd`. */
  cost: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  /**
   * True only when the row carried explicit prompt AND completion token
   * fields (`req_units`/`res_units`, `prompt_tokens`/`completion_tokens`,
   * `input_tokens`/`output_tokens`). When false, `promptTokens` and
   * `completionTokens` are placeholders and only `totalTokens` is trustworthy.
   */
  hasTokenSplit: boolean;
  lastSeenAt: string | null;
  raw: Record<string, unknown>;
};

/**
 * Portkey reports every monetary figure in cents: the `/analytics/graphs/cost`
 * response documents `total` as "Total cost in cents", and the grouped
 * `/analytics/groups/users` rows document `cost` as "Total cost in cents". The
 * `/analytics/groups/ai-models` rows expose an undocumented `cost` field; we
 * assume it uses the same unit as the users endpoint and the graph so that
 * per-model, per-user and org-level totals reconcile. The sync run records a
 * reconciliation block (graph total vs. summed grouped totals) so this
 * assumption is auditable in production.
 */
export const PORTKEY_COST_DIVISOR = 100;

export function portkeyCostToUsd(costInCents: number): number {
  return Number.isFinite(costInCents) ? costInCents / PORTKEY_COST_DIVISOR : 0;
}

export type PortkeyDayWindow = {
  /** YYYY-MM-DD (UTC) — used in dimension keys. */
  date: string;
  /** Full UTC-day bucket bounds so upserts stay idempotent across runs. */
  bucketStart: Date;
  bucketEnd: Date;
  /** Query bounds sent to Portkey; the last day is clamped to `end`. */
  startTime: string;
  endTime: string;
};

/**
 * Split an arbitrary window into UTC day windows. Portkey's grouped
 * analytics endpoints aggregate over the whole requested range, so to keep
 * Portkey buckets at day granularity (like every other provider) the sync
 * issues one grouped call per day. Bucket bounds are always full days; only
 * the query bounds are clamped to the requested window.
 */
export function buildPortkeyDayWindows(start: Date, end: Date): PortkeyDayWindow[] {
  const windows: PortkeyDayWindow[] = [];
  if (!(start instanceof Date) || !(end instanceof Date)) return windows;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return windows;

  let dayStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  while (dayStart < end) {
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const queryStart = dayStart > start ? dayStart : start;
    const queryEnd = dayEnd < end ? dayEnd : end;
    windows.push({
      date: dayStart.toISOString().slice(0, 10),
      bucketStart: dayStart,
      bucketEnd: dayEnd,
      startTime: queryStart.toISOString(),
      endTime: queryEnd.toISOString(),
    });
    dayStart = dayEnd;
  }
  return windows;
}

export type PortkeyGroupedPageFetcher = (args: {
  startTime: string;
  endTime: string;
  currentPage: number;
  pageSize: number;
}) => Promise<Record<string, unknown>>;

export type PortkeyGroupedPagesResult = {
  rows: PortkeyGroupedRow[];
  /** Number of pages actually fetched. */
  pages: number;
  /** True when the page cap was reached while the endpoint still had more rows. */
  truncated: boolean;
};

export const PORTKEY_DEFAULT_PAGE_SIZE = 100;
export const PORTKEY_DEFAULT_MAX_PAGES = 20;

/**
 * Read every page of a Portkey grouped-analytics endpoint for one window.
 * Stops on the first short page; when `maxPages` is exhausted while the last
 * page was still full the result is flagged `truncated` so the caller can
 * record it in the sync run metadata instead of silently under-counting.
 */
export async function readPortkeyGroupedPages(
  fetchPage: PortkeyGroupedPageFetcher,
  options: {
    startTime: string;
    endTime: string;
    labelKeys: string[];
    pageSize?: number;
    maxPages?: number;
  },
): Promise<PortkeyGroupedPagesResult> {
  const pageSize = options.pageSize ?? PORTKEY_DEFAULT_PAGE_SIZE;
  const maxPages = options.maxPages ?? PORTKEY_DEFAULT_MAX_PAGES;
  const rows: PortkeyGroupedRow[] = [];
  let pages = 0;
  let truncated = false;

  for (let currentPage = 0; currentPage < maxPages; currentPage++) {
    const payload = await fetchPage({
      startTime: options.startTime,
      endTime: options.endTime,
      currentPage,
      pageSize,
    });
    pages++;
    const rawCount = asArray(asRecord(payload).data).length;
    rows.push(...normalizePortkeyGroupedRows(payload, options.labelKeys));
    if (rawCount < pageSize) return { rows, pages, truncated };
    if (currentPage === maxPages - 1) truncated = true;
  }

  return { rows, pages, truncated };
}

export type PortkeyGraphPoint = {
  timestamp: string;
  total: number;
  avg: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function getApiKey(): Promise<string> {
  const key = await getSetting(PORTKEY_SETTINGS.API_KEY);
  if (!key) {
    throw new Error("Portkey API key not configured. Add it in Settings > Provider Admin APIs.");
  }
  return key;
}

async function getBaseUrl(): Promise<string> {
  return ((await getSetting(PORTKEY_SETTINGS.API_BASE_URL)) ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

async function getWorkspaceSlug(): Promise<string | null> {
  return await getSetting(PORTKEY_SETTINGS.WORKSPACE_SLUG);
}

async function portkeyFetch(path: string, params: Record<string, string | number | undefined> = {}) {
  const [apiKey, baseUrl, workspaceSlug] = await Promise.all([
    getApiKey(),
    getBaseUrl(),
    getWorkspaceSlug(),
  ]);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  }
  if (workspaceSlug && !query.has("workspace_slug")) {
    query.set("workspace_slug", workspaceSlug);
  }

  const qs = query.toString();
  const res = await fetch(`${baseUrl}${path}${qs ? `?${qs}` : ""}`, {
    headers: {
      "x-portkey-api-key": apiKey,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(
      `Portkey API error (${res.status}): ${
        asString(asRecord(err).message) ??
        asString(asRecord(asRecord(err).error).message) ??
        res.statusText
      }`
    );
  }

  return (await res.json()) as Record<string, unknown>;
}

export async function isPortkeyConfigured(): Promise<boolean> {
  return !!(await getSetting(PORTKEY_SETTINGS.API_KEY));
}

export async function getPortkeyModelGroups(params: {
  startTime: string;
  endTime: string;
  currentPage?: number;
  pageSize?: number;
}) {
  return portkeyFetch("/analytics/groups/ai-models", {
    time_of_generation_min: params.startTime,
    time_of_generation_max: params.endTime,
    current_page: params.currentPage ?? 0,
    page_size: params.pageSize ?? 100,
  });
}

export async function getPortkeyUserGroups(params: {
  startTime: string;
  endTime: string;
  currentPage?: number;
  pageSize?: number;
}) {
  return portkeyFetch("/analytics/groups/users", {
    time_of_generation_min: params.startTime,
    time_of_generation_max: params.endTime,
    current_page: params.currentPage ?? 0,
    page_size: params.pageSize ?? 100,
  });
}

export async function getPortkeyTokensGraph(params: { startTime: string; endTime: string }) {
  return portkeyFetch("/analytics/graphs/tokens", {
    time_of_generation_min: params.startTime,
    time_of_generation_max: params.endTime,
  });
}

export async function getPortkeyCostGraph(params: { startTime: string; endTime: string }) {
  return portkeyFetch("/analytics/graphs/cost", {
    time_of_generation_min: params.startTime,
    time_of_generation_max: params.endTime,
  });
}

export function normalizePortkeyGroupedRows(
  payload: unknown,
  labelKeys: string[],
): PortkeyGroupedRow[] {
  return asArray(asRecord(payload).data)
    .map((row) => {
      const label =
        labelKeys
          .map((key) => asString(row[key]))
          .find((value) => value && value.length > 0) ?? null;
      const promptTokens =
        asNumber(row.prompt_tokens) ||
        asNumber(row.req_units) ||
        asNumber(row.input_tokens);
      const completionTokens =
        asNumber(row.completion_tokens) ||
        asNumber(row.res_units) ||
        asNumber(row.output_tokens);
      const hasPromptField = ["prompt_tokens", "req_units", "input_tokens"].some(
        (key) => row[key] !== undefined && row[key] !== null,
      );
      const hasCompletionField = ["completion_tokens", "res_units", "output_tokens"].some(
        (key) => row[key] !== undefined && row[key] !== null,
      );
      const totalTokens =
        asNumber(row.total_units) ||
        asNumber(row.total_tokens) ||
        promptTokens + completionTokens;
      return {
        label,
        requests: asNumber(row.requests),
        cost: asNumber(row.cost),
        totalTokens,
        promptTokens,
        completionTokens,
        hasTokenSplit: hasPromptField && hasCompletionField,
        lastSeenAt:
          asString(row.last_seen) ??
          asString(row.last_seen_at) ??
          null,
        raw: row,
      };
    })
    .filter((row) => row.label || row.requests > 0 || row.totalTokens > 0 || row.cost > 0);
}

export function normalizePortkeyGraphPoints(payload: unknown): PortkeyGraphPoint[] {
  return asArray(asRecord(payload).data_points)
    .map((point) => ({
      timestamp: asString(point.timestamp) ?? "",
      total: asNumber(point.total),
      avg: asNumber(point.avg),
    }))
    .filter((point) => point.timestamp.length > 0);
}

export async function testPortkey(): Promise<{ success: boolean; message: string }> {
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    await getPortkeyTokensGraph({
      startTime: yesterday.toISOString(),
      endTime: now.toISOString(),
    });
    return {
      success: true,
      message: "Connected to Portkey analytics API successfully.",
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Connection failed",
    };
  }
}
