import { getSetting } from "./settings";

const DEFAULT_BASE_URL = "https://api.helicone.ai";

export const HELICONE_SETTINGS = {
  API_KEY: "helicone_api_key",
  API_BASE_URL: "helicone_api_base_url",
} as const;

export type HeliconeRequestRow = {
  requestCreatedAt: string;
  provider: string | null;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  userId: string | null;
  status: number | null;
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
  const key = await getSetting(HELICONE_SETTINGS.API_KEY);
  if (!key) {
    throw new Error("Helicone API key not configured. Add it in Settings > Provider Admin APIs.");
  }
  return key;
}

async function getBaseUrl(): Promise<string> {
  return (await getSetting(HELICONE_SETTINGS.API_BASE_URL)) ?? DEFAULT_BASE_URL;
}

async function heliconeFetch(path: string, body: Record<string, unknown>) {
  const [apiKey, baseUrl] = await Promise.all([getApiKey(), getBaseUrl()]);
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(
      `Helicone API error (${res.status}): ${asString(asRecord(err).error) ?? res.statusText}`
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

export async function isHeliconeConfigured(): Promise<boolean> {
  return !!(await getSetting(HELICONE_SETTINGS.API_KEY));
}

export async function queryHeliconeRequests(params: {
  startTime: string;
  endTime: string;
  offset?: number;
  limit?: number;
}) {
  return heliconeFetch("/v1/request/query-clickhouse", {
    filter: {
      request_response_rmt: {
        request_created_at: {
          gte: params.startTime,
          lte: params.endTime,
        },
      },
    },
    offset: params.offset ?? 0,
    limit: params.limit ?? 500,
    sort: {
      request_created_at: "asc",
    },
    includeInputs: false,
  });
}

export function normalizeHeliconeRequestRows(payload: unknown): HeliconeRequestRow[] {
  return asArray(asRecord(payload).data)
    .map((row) => {
      const wrapped = asRecord(row.request_response_rmt);
      const source = Object.keys(wrapped).length > 0 ? wrapped : row;
      const promptTokens = asNumber(source.prompt_tokens);
      const completionTokens = asNumber(source.completion_tokens);
      const totalTokens = asNumber(source.total_tokens) || promptTokens + completionTokens;

      return {
        requestCreatedAt:
          asString(source.request_created_at) ??
          asString(source.created_at) ??
          "",
        provider: asString(source.provider),
        model: asString(source.model),
        promptTokens,
        completionTokens,
        totalTokens,
        cost: asNumber(source.cost),
        userId: asString(source.user_id),
        status: Number.isFinite(asNumber(source.status)) ? asNumber(source.status) : null,
      };
    })
    .filter((row) => row.requestCreatedAt.length > 0);
}

export async function testHelicone(): Promise<{ success: boolean; message: string }> {
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    await queryHeliconeRequests({
      startTime: yesterday.toISOString(),
      endTime: now.toISOString(),
      limit: 1,
    });
    return {
      success: true,
      message: "Connected to Helicone request API successfully.",
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Connection failed",
    };
  }
}
