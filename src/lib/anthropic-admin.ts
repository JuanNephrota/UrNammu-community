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
export async function listAPIKeys(params?: { status?: string; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return adminFetch(`/v1/organizations/api_keys${qs ? `?${qs}` : ""}`);
}

/** List organization members */
export async function listMembers(params?: { limit?: number }) {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return adminFetch(`/v1/organizations/users${qs ? `?${qs}` : ""}`);
}

/** Get usage report — tokens and costs by model/workspace/key */
export async function getUsageReport(params: {
  starting_at: string; // ISO 8601 timestamp, e.g. 2025-01-08T00:00:00Z
  ending_at: string;
  group_by?: string[]; // model, workspace, api_key
  bucket_width?: string; // 1m, 1h, 1d (default 1d)
}) {
  const query = new URLSearchParams();
  query.set("starting_at", params.starting_at);
  query.set("ending_at", params.ending_at);
  query.set("bucket_width", params.bucket_width ?? "1d");
  if (params.group_by) {
    for (const g of params.group_by) query.append("group_by[]", g);
  }
  return adminFetch(`/v1/organizations/usage_report/messages?${query}`);
}

/** Get cost report — USD costs by workspace/description */
export async function getCostReport(params: {
  starting_at: string; // ISO 8601 timestamp
  ending_at: string;
  group_by?: string[]; // workspace_id, description
  bucket_width?: string; // only 1d supported
}) {
  const query = new URLSearchParams();
  query.set("starting_at", params.starting_at);
  query.set("ending_at", params.ending_at);
  query.set("bucket_width", params.bucket_width ?? "1d");
  if (params.group_by) {
    for (const g of params.group_by) query.append("group_by[]", g);
  }
  return adminFetch(`/v1/organizations/cost_report?${query}`);
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
