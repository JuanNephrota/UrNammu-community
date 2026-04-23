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
  cost: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  lastSeenAt: string | null;
  raw: Record<string, unknown>;
};

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
