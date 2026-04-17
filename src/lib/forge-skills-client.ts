/**
 * HTTP client for the CertifID Forge Security Integration API.
 *
 * Phase 1 endpoints:
 *   GET /skills?since=<iso>&limit=<n>&cursor=<opaque>
 *   GET /skills/{id}
 *   GET /skills/{id}/content
 *
 * All requests carry `Authorization: Bearer forge_sec_...`. Rate limit is
 * 60 req/min per key; callers (the sync job) pace themselves. We don't
 * retry here — retries live in the sync layer so they see the full picture.
 */

import { FORGE_DEFAULT_BASE_URL, FORGE_SETTINGS_KEYS, getSetting } from "./settings";

// Shape of one skill row as returned by the list endpoint.
export type ForgeSkill = {
  id: string;
  name: string;
  content_type: string;
  file_type: string | null;
  file_name?: string | null;
  file_size_bytes?: number | null;
  sha256?: string | null;
  status: string;
  app_url: string | null;
  tags: string[];
  current_version: number;
  author: {
    id: string | null;
    name: string | null;
    department_id: string | null;
    department_name?: string | null;
  };
  department: { id: string | null; name: string | null } | null;
  category: { id: string | null; name: string | null } | null;
  is_featured_global?: boolean;
  upvote_count?: number;
  download_count?: number;
  created_at: string;
  updated_at: string;
};

export type ForgeListResponse = {
  items: ForgeSkill[];
  cursor: string | null;
  has_more: boolean;
};

export type ForgeContentResponse = {
  id: string;
  file_name: string | null;
  file_size_bytes: number | null;
  file_type: string | null;
  content_url: string | null;
  expires_at: string | null;
  sha256: string | null;
};

export class ForgeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "ForgeApiError";
  }
}

export type ForgeConfig = {
  apiKey: string;
  baseUrl: string;
};

export async function loadForgeConfig(): Promise<ForgeConfig | null> {
  const [apiKey, baseUrl] = await Promise.all([
    getSetting(FORGE_SETTINGS_KEYS.API_KEY),
    getSetting(FORGE_SETTINGS_KEYS.BASE_URL),
  ]);
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (baseUrl?.trim() || FORGE_DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

async function forgeFetch<T>(
  config: ForgeConfig,
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      ...(init?.headers ?? {}),
    },
    // We're calling an external API from a server action / cron — no caching.
    cache: "no-store",
  });

  if (!res.ok) {
    let message = `Forge API ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {
      /* body not JSON */
    }
    const retryAfter = res.headers.get("Retry-After");
    throw new ForgeApiError(
      message,
      res.status,
      retryAfter ? Number(retryAfter) : undefined
    );
  }

  return (await res.json()) as T;
}

export async function listForgeSkills(
  config: ForgeConfig,
  params: { since?: string; cursor?: string; limit?: number } = {}
): Promise<ForgeListResponse> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit ?? 100));
  if (params.since) qs.set("since", params.since);
  if (params.cursor) qs.set("cursor", params.cursor);
  return forgeFetch<ForgeListResponse>(config, `/skills?${qs.toString()}`);
}

export async function getForgeSkill(
  config: ForgeConfig,
  id: string
): Promise<ForgeSkill> {
  return forgeFetch<ForgeSkill>(config, `/skills/${encodeURIComponent(id)}`);
}

export async function getForgeSkillContent(
  config: ForgeConfig,
  id: string
): Promise<ForgeContentResponse> {
  return forgeFetch<ForgeContentResponse>(
    config,
    `/skills/${encodeURIComponent(id)}/content`
  );
}
