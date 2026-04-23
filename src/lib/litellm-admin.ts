import { getSetting } from "./settings";

export const LITELLM_SETTINGS = {
  API_KEY: "litellm_api_key",
  API_BASE_URL: "litellm_api_base_url",
} as const;

export type LiteLLMSpendLogRow = {
  requestId: string | null;
  startTime: string;
  endTime: string | null;
  model: string | null;
  provider: string | null;
  callType: string | null;
  userId: string | null;
  apiKeyExternalId: string | null;
  apiKeyName: string | null;
  teamId: string | null;
  teamName: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  status: string | null;
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
  const key = await getSetting(LITELLM_SETTINGS.API_KEY);
  if (!key) {
    throw new Error("LiteLLM master key not configured. Add it in Settings > Provider Admin APIs.");
  }
  return key;
}

async function getBaseUrl(): Promise<string> {
  const raw = await getSetting(LITELLM_SETTINGS.API_BASE_URL);
  if (!raw) {
    throw new Error("LiteLLM base URL not configured. LiteLLM is typically self-hosted; set the proxy base URL.");
  }
  return raw.replace(/\/+$/, "");
}

async function litellmFetch(path: string, params: Record<string, string | number | undefined> = {}) {
  const [apiKey, baseUrl] = await Promise.all([getApiKey(), getBaseUrl()]);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  }
  const qs = query.toString();
  const res = await fetch(`${baseUrl}${path}${qs ? `?${qs}` : ""}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    const errorBody = asRecord(err);
    throw new Error(
      `LiteLLM API error (${res.status}): ${
        asString(errorBody.error) ??
        asString(asRecord(errorBody.detail).message) ??
        asString(errorBody.detail) ??
        res.statusText
      }`
    );
  }
  return (await res.json()) as unknown;
}

export async function isLiteLLMConfigured(): Promise<boolean> {
  const [apiKey, baseUrl] = await Promise.all([
    getSetting(LITELLM_SETTINGS.API_KEY),
    getSetting(LITELLM_SETTINGS.API_BASE_URL),
  ]);
  return !!(apiKey && baseUrl);
}

export async function queryLiteLLMSpendLogs(params: {
  startDate: string;
  endDate: string;
}) {
  return litellmFetch("/spend/logs", {
    start_date: params.startDate,
    end_date: params.endDate,
  });
}

export async function getLiteLLMModelInfo() {
  return litellmFetch("/model/info");
}

export function normalizeLiteLLMSpendRows(payload: unknown): LiteLLMSpendLogRow[] {
  const rows = Array.isArray(payload) ? payload.map(asRecord) : asArray(asRecord(payload).data);

  return rows
    .map((row): LiteLLMSpendLogRow => {
      const metadata = asRecord(row.metadata);
      const promptTokens = asNumber(row.prompt_tokens);
      const completionTokens = asNumber(row.completion_tokens);
      const totalTokens = asNumber(row.total_tokens) || promptTokens + completionTokens;
      return {
        requestId: asString(row.request_id),
        startTime:
          asString(row.startTime) ??
          asString(row.start_time) ??
          asString(row.created_at) ??
          "",
        endTime: asString(row.endTime) ?? asString(row.end_time),
        model: asString(row.model),
        provider: asString(row.custom_llm_provider) ?? asString(metadata.custom_llm_provider),
        callType: asString(row.call_type),
        userId: asString(row.user) ?? asString(row.end_user),
        apiKeyExternalId: asString(row.api_key),
        apiKeyName: asString(row.key_name) ?? asString(row.key_alias),
        teamId: asString(row.team_id),
        teamName: asString(row.team_alias),
        promptTokens,
        completionTokens,
        totalTokens,
        cost: asNumber(row.spend),
        status: asString(row.status),
      };
    })
    .filter((row) => row.startTime.length > 0);
}

export async function testLiteLLM(): Promise<{ success: boolean; message: string }> {
  try {
    await getLiteLLMModelInfo();
    return {
      success: true,
      message: "Connected to LiteLLM proxy successfully.",
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Connection failed",
    };
  }
}
