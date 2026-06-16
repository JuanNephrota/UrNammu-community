import { getSetting } from "./settings";

const BASE_URL = "https://openrouter.ai/api/v1";

export const OPENROUTER_SETTINGS = {
  PROVISIONING_KEY: "openrouter_provisioning_key",
} as const;

export type OpenRouterActivityRow = {
  date: string;
  model: string | null;
  modelPermaslug: string | null;
  endpointId: string | null;
  providerName: string | null;
  usage: number;
  byokUsageInference: number;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
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

async function getProvisioningKey(): Promise<string> {
  const key = await getSetting(OPENROUTER_SETTINGS.PROVISIONING_KEY);
  if (!key) {
    throw new Error(
      "OpenRouter provisioning key not configured. Add it in Settings > Provider Admin APIs."
    );
  }
  return key;
}

async function openRouterFetch(path: string): Promise<Record<string, unknown>> {
  const key = await getProvisioningKey();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(
      `OpenRouter API error (${res.status}): ${asString(asRecord(err).error) ?? res.statusText}`
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

export async function isOpenRouterConfigured(): Promise<boolean> {
  return !!(await getSetting(OPENROUTER_SETTINGS.PROVISIONING_KEY));
}

export async function getOpenRouterActivity(date?: string) {
  const query = new URLSearchParams();
  if (date) query.set("date", date);
  const qs = query.toString();
  return openRouterFetch(`/activity${qs ? `?${qs}` : ""}`);
}

export function normalizeOpenRouterActivityRows(payload: unknown): OpenRouterActivityRow[] {
  return asArray(asRecord(payload).data)
    .map((row) => ({
      date: asString(row.date) ?? "",
      model: asString(row.model),
      modelPermaslug: asString(row.model_permaslug),
      endpointId: asString(row.endpoint_id),
      providerName: asString(row.provider_name),
      usage: asNumber(row.usage),
      byokUsageInference: asNumber(row.byok_usage_inference),
      requests: asNumber(row.requests),
      promptTokens: asNumber(row.prompt_tokens),
      completionTokens: asNumber(row.completion_tokens),
      reasoningTokens: asNumber(row.reasoning_tokens),
    }))
    .filter((row) => row.date.length > 0);
}

export async function testOpenRouter(): Promise<{ success: boolean; message: string }> {
  try {
    await getOpenRouterActivity();
    return {
      success: true,
      message: "Connected to OpenRouter activity API successfully.",
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Connection failed",
    };
  }
}
