import { getSetting } from "./settings";
import {
  CHATGPT_LOG_EVENT_TYPES,
  parseJsonl,
  type ChatGPTLogEventType,
  type ChatGPTLogFileMetadata,
  type ChatGPTWorkspaceGpt,
  type ChatGPTWorkspaceUser,
  type ComplianceLogEnvelope,
} from "./chatgpt-enterprise-compliance";

// OpenAI Programmatic Admin Platform client for ChatGPT Enterprise / Edu
// workspaces (the "Compliance API"). Mirrors the other provider-admin
// clients. Reference: https://chatgpt.com/public/admin/api-reference
// (OpenAPI at /public/admin/api-reference/openapi.json, verified 2026-09-16).
//
// Auth is a workspace-scoped Admin key created by a workspace owner/admin in
// the Admin Console (Credentials > Admin keys), sent as a Bearer token. Every
// route is scoped by the ChatGPT workspace id. The Compliance Logs Platform
// retains files for 30 days; the sync must run regularly to build history.

const BASE_URL = "https://api.chatgpt.com/v1";

export const CHATGPT_ENTERPRISE_SETTINGS = {
  ADMIN_KEY: "chatgpt_enterprise_admin_key",
  WORKSPACE_ID: "chatgpt_workspace_id",
} as const;

/** Users page size (API default 200). */
const USERS_PAGE_SIZE = 200;
const USERS_MAX_PAGES = 100;
/** GPTs page size (API default 20). */
const GPTS_PAGE_SIZE = 50;
const GPTS_MAX_PAGES = 200;
/** Log-file listing page size (API default 100). */
export const LOG_FILES_PAGE_SIZE = 100;
/** Retries on 429 before giving up. */
const MAX_RATE_LIMIT_RETRIES = 2;

export class ChatGPTEnterpriseApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ChatGPTEnterpriseApiError";
    this.status = status;
  }
}

async function getCredentials(): Promise<{ key: string; workspaceId: string }> {
  const [key, workspaceId] = await Promise.all([
    getSetting(CHATGPT_ENTERPRISE_SETTINGS.ADMIN_KEY),
    getSetting(CHATGPT_ENTERPRISE_SETTINGS.WORKSPACE_ID),
  ]);
  if (!key || !workspaceId) {
    throw new Error(
      "ChatGPT Enterprise Admin key or workspace id not configured. Add both under Settings > Integrations > ChatGPT Enterprise.",
    );
  }
  return { key, workspaceId: workspaceId.trim() };
}

export async function getChatGPTWorkspaceId(): Promise<string> {
  return (await getCredentials()).workspaceId;
}

export async function isChatGPTEnterpriseConfigured(): Promise<boolean> {
  const [key, workspaceId] = await Promise.all([
    getSetting(CHATGPT_ENTERPRISE_SETTINGS.ADMIN_KEY),
    getSetting(CHATGPT_ENTERPRISE_SETTINGS.WORKSPACE_ID),
  ]);
  return !!key && !!workspaceId?.trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(res: Response): number {
  const header = res.headers.get("retry-after");
  const seconds = header ? Number(header) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 30) * 1000;
  return 2000;
}

async function adminRequest(
  path: string,
  query: Record<string, string | string[] | number | undefined> = {},
  init: { accept?: string } = {},
): Promise<Response> {
  const { key } = await getCredentials();
  const url = new URL(`${BASE_URL}${path}`);
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) url.searchParams.append(name, v);
    } else {
      url.searchParams.set(name, String(value));
    }
  }

  let attempt = 0;
  for (;;) {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: init.accept ?? "application/json",
      },
      // Log downloads answer with a 307 to a short-lived signed URL. fetch
      // follows it and drops the Authorization header on the cross-origin hop.
      redirect: "follow",
    });
    if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      attempt++;
      await sleep(retryAfterMs(res));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = text;
      try {
        const err = JSON.parse(text);
        msg = err?.error?.message ?? err?.detail ?? err?.message ?? text;
        if (typeof msg !== "string") msg = JSON.stringify(msg);
      } catch {
        // plain-text body
      }
      throw new ChatGPTEnterpriseApiError(
        res.status,
        `ChatGPT Enterprise Admin API error (${res.status}) on ${path}: ${msg || res.statusText}`,
      );
    }
    return res;
  }
}

async function adminGet<T>(
  path: string,
  query: Record<string, string | string[] | number | undefined> = {},
): Promise<T> {
  const res = await adminRequest(path, query);
  return (await res.json()) as T;
}

// ─── Stateful resources ──────────────────────────────────

interface ListEnvelope<T> {
  object?: string;
  data?: T[];
  has_more?: boolean;
  last_id?: string | null;
}

/**
 * Every workspace user, including inactive ones (the compliance export is
 * historical). Ordered by user id; pages follow `last_id` → `after`.
 */
export async function listChatGPTWorkspaceUsers(
  workspaceId: string,
): Promise<{ users: ChatGPTWorkspaceUser[]; truncated: boolean }> {
  const users: ChatGPTWorkspaceUser[] = [];
  let after: string | undefined;
  for (let page = 0; page < USERS_MAX_PAGES; page++) {
    const res = await adminGet<ListEnvelope<ChatGPTWorkspaceUser>>(
      `/compliance/workspaces/${encodeURIComponent(workspaceId)}/users`,
      { limit: USERS_PAGE_SIZE, after },
    );
    users.push(...(res.data ?? []));
    if (!res.has_more || !res.last_id) return { users, truncated: false };
    after = res.last_id;
  }
  return { users, truncated: true };
}

/**
 * Every live workspace GPT with its latest configuration (tools included).
 * Third-party GPTs are not returned by this route.
 */
export async function listChatGPTWorkspaceGpts(
  workspaceId: string,
): Promise<{ gpts: ChatGPTWorkspaceGpt[]; truncated: boolean }> {
  const gpts: ChatGPTWorkspaceGpt[] = [];
  let after: string | undefined;
  for (let page = 0; page < GPTS_MAX_PAGES; page++) {
    const res = await adminGet<ListEnvelope<ChatGPTWorkspaceGpt>>(
      `/compliance/workspaces/${encodeURIComponent(workspaceId)}/gpts`,
      { limit: GPTS_PAGE_SIZE, after, file_format: "id" },
    );
    gpts.push(...(res.data ?? []));
    if (!res.has_more || !res.last_id) return { gpts, truncated: false };
    after = res.last_id;
  }
  return { gpts, truncated: true };
}

// ─── Compliance Logs Platform ────────────────────────────

export interface ChatGPTLogFileListPage {
  data: ChatGPTLogFileMetadata[];
  has_more: boolean;
  last_end_time: string | null;
}

/**
 * One page of log-file metadata for `eventType`, ordered by `end_time`
 * ascending. `after` is exclusive: pass the previous page's `last_end_time`.
 */
export async function listChatGPTLogFiles(
  workspaceId: string,
  eventType: ChatGPTLogEventType,
  after: Date,
  options: { before?: Date; limit?: number } = {},
): Promise<ChatGPTLogFileListPage> {
  const res = await adminGet<Partial<ChatGPTLogFileListPage>>(
    `/compliance/workspaces/${encodeURIComponent(workspaceId)}/logs`,
    {
      event_type: eventType,
      after: after.toISOString(),
      before: options.before?.toISOString(),
      limit: options.limit ?? LOG_FILES_PAGE_SIZE,
    },
  );
  return {
    data: Array.isArray(res.data) ? res.data : [],
    has_more: res.has_more === true,
    last_end_time: typeof res.last_end_time === "string" ? res.last_end_time : null,
  };
}

/** Download one log file (redirect → signed URL) and parse it as JSONL. */
export async function downloadChatGPTLogFile(
  workspaceId: string,
  logFileId: string,
): Promise<{ records: ComplianceLogEnvelope[]; malformed: number; bytes: number }> {
  const res = await adminRequest(
    `/compliance/workspaces/${encodeURIComponent(workspaceId)}/logs/${encodeURIComponent(logFileId)}`,
    {},
    { accept: "application/x-ndjson, application/json, text/plain" },
  );
  const text = await res.text();
  const parsed = parseJsonl(text);
  return { records: parsed.records as ComplianceLogEnvelope[], malformed: parsed.malformed, bytes: text.length };
}

/** Newest retained event timestamp per requested log type (null = none). */
export async function getChatGPTLogFreshness(
  workspaceId: string,
  eventTypes: readonly ChatGPTLogEventType[] = CHATGPT_LOG_EVENT_TYPES,
): Promise<Record<string, string | null>> {
  const res = await adminGet<{ max_event_time?: Record<string, string | null> }>(
    `/compliance/workspaces/${encodeURIComponent(workspaceId)}/max_event_time`,
    { event_type: [...eventTypes] },
  );
  return res.max_event_time ?? {};
}

/** Test the admin key + workspace id with the two cheapest calls. */
export async function testChatGPTEnterprise(): Promise<{ success: boolean; message: string }> {
  try {
    const { workspaceId } = await getCredentials();
    const users = await adminGet<ListEnvelope<ChatGPTWorkspaceUser>>(
      `/compliance/workspaces/${encodeURIComponent(workspaceId)}/users`,
      { limit: 1 },
    );
    let freshnessNote = "";
    try {
      const freshness = await getChatGPTLogFreshness(workspaceId, ["AUTH_LOG", "AUDIT_LOG"]);
      const parts = Object.entries(freshness).map(
        ([type, ts]) => `${type}: ${ts ? new Date(ts).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "no files"}`,
      );
      if (parts.length) freshnessNote = ` Log freshness — ${parts.join(", ")}.`;
    } catch (err) {
      freshnessNote =
        err instanceof ChatGPTEnterpriseApiError && err.status === 403
          ? " Key lacks the Compliance logging platform read scope; auth/audit logs will be skipped."
          : "";
    }
    const visible = users.data?.length ?? 0;
    return {
      success: true,
      message: `Connected to ChatGPT workspace ${workspaceId} (${visible > 0 ? "users visible" : "no users returned"}).${freshnessNote}`,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Connection failed",
    };
  }
}
