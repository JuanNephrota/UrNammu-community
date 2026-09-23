/**
 * Pure helpers for the ChatGPT Enterprise Compliance API sync: JSONL parsing,
 * event typing, per-user daily aggregation, alert detection, and the log
 * cursor rules. No Prisma and no network so everything here is unit-tested
 * offline; the fetching lives in `chatgpt-enterprise-admin.ts` and the
 * database writes in `provider-telemetry.ts` (`syncChatGPTEnterprise`).
 *
 * Boundary: conversation messages and Codex prompts/responses are aggregated
 * into counts and token totals only. Message text, titles, prompt text,
 * response text, and tool inputs never leave this module.
 *
 * Reference (verified 2026-09-16 against the published OpenAPI document at
 * https://chatgpt.com/public/admin/api-reference/openapi.json):
 *   GET /v1/compliance/workspaces/{ws}/users            (id, email, name, created_at, role, status)
 *   GET /v1/compliance/workspaces/{ws}/gpts             (latest_config.data[].tools.data[].type)
 *   GET /v1/compliance/workspaces/{ws}/logs?event_type=&after=   → files, has_more, last_end_time
 *   GET /v1/compliance/workspaces/{ws}/logs/{id}        → 307 → JSONL
 *   GET /v1/compliance/workspaces/{ws}/max_event_time?event_type=
 */

import type { DiscoveredAgentInput } from "./agent-discovery";

// ─── Event types and cursor constants ─────────────────────────────────────

export const CHATGPT_LOG_EVENT_TYPES = [
  "AUTH_LOG",
  "AUDIT_LOG",
  "CONVERSATION_MESSAGE",
  "CODEX_LOG",
  "CODEX_TURN",
] as const;

export type ChatGPTLogEventType = (typeof CHATGPT_LOG_EVENT_TYPES)[number];

export function isChatGPTLogEventType(value: unknown): value is ChatGPTLogEventType {
  return typeof value === "string" && (CHATGPT_LOG_EVENT_TYPES as readonly string[]).includes(value);
}

/** Watermark row keys in ProviderSyncWatermark. */
export const CHATGPT_SYNC_PROVIDER = "chatgpt_enterprise";
export function chatgptStreamWatermarkKey(stream: ChatGPTLogEventType | "GPTS"): string {
  return `${CHATGPT_SYNC_PROVIDER}:${stream}`;
}

/** The Compliance Logs Platform keeps files for 30 days. */
export const CHATGPT_LOG_RETENTION_DAYS = 30;
/** First-ever sync reaches this far back rather than the full retention. */
export const CHATGPT_LOG_INITIAL_LOOKBACK_DAYS = 7;
/** Files downloaded per event type per run (each file ≤ 15 MB). */
export const CHATGPT_LOG_MAX_FILES_PER_RUN = 40;
/** Bytes downloaded per event type per run before the stream yields. */
export const CHATGPT_LOG_MAX_BYTES_PER_RUN = 60 * 1024 * 1024;

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Upstream shapes (subset consumed) ────────────────────────────────────

export interface ChatGPTWorkspaceUser {
  id?: string;
  email?: string | null;
  name?: string | null;
  /** Unix seconds. */
  created_at?: number | string | null;
  /** account-owner | account-admin | analytics-viewer | standard-user */
  role?: string | null;
  /** active | inactive */
  status?: string | null;
  [k: string]: unknown;
}

export interface ChatGPTGptTool {
  /** code_interpreter | browser | dall-e | memory | custom_action */
  type?: string;
  created_at?: number | string | null;
  action_domain?: string | null;
  auth_type?: string | null;
  [k: string]: unknown;
}

export interface ChatGPTGptConfig {
  id?: string;
  name?: string | null;
  created_at?: number | string | null;
  version_author?: { id?: string; email?: string } | null;
  tools?: { data?: ChatGPTGptTool[] } | null;
  [k: string]: unknown;
}

export interface ChatGPTWorkspaceGpt {
  id?: string;
  created_at?: number | string | null;
  owner_id?: string | null;
  owner_email?: string | null;
  builder_name?: string | null;
  sharing?: { visibility?: string | null } | null;
  latest_config?: { data?: ChatGPTGptConfig[] } | null;
  [k: string]: unknown;
}

export interface ChatGPTLogFileMetadata {
  id: string;
  event_type: string;
  /** ISO 8601. */
  end_time: string;
  file_name?: string;
  file_size?: number;
  file_sha256?: string;
}

export interface ComplianceLogActor {
  /** ACCOUNT_USER | API_KEY | EXTERNAL_COLLABORATION_USER */
  type?: string;
  user_id?: string;
  user_email?: string;
  credential_id?: string;
  redacted_id?: string;
  provider?: string;
  provider_user_id?: string;
  [k: string]: unknown;
}

/** Shared Logs Platform envelope; per-type fields are read via helpers below. */
export interface ComplianceLogEnvelope {
  event_id?: string;
  type?: string;
  /** ISO 8601 (UTC). */
  timestamp?: string;
  principal?: { id?: string; type?: string };
  actor?: ComplianceLogActor;
  [k: string]: unknown;
}

// ─── Small readers ────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Unix seconds (number or numeric string) → Date, or null. */
export function unixSecondsToDate(value: unknown): Date | null {
  const n = asNumber(value);
  if (n <= 0) return null;
  // Guard against a value already in milliseconds.
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function eventTimestamp(event: ComplianceLogEnvelope): Date | null {
  const raw = asString(event.timestamp);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "YYYY-MM-DD" (UTC) of the event, or null when the timestamp is unusable. */
export function eventDay(event: ComplianceLogEnvelope): string | null {
  const d = eventTimestamp(event);
  return d ? d.toISOString().slice(0, 10) : null;
}

export interface NormalizedActor {
  type: string | null;
  email: string | null;
  userId: string | null;
  apiKeyId: string | null;
}

export function normalizeActor(event: ComplianceLogEnvelope): NormalizedActor {
  const actor = asRecord(event.actor);
  const email = asString(actor.user_email);
  return {
    type: asString(actor.type),
    email: email ? email.toLowerCase() : null,
    userId: asString(actor.user_id),
    apiKeyId: asString(actor.redacted_id) ?? asString(actor.credential_id),
  };
}

// ─── JSONL ────────────────────────────────────────────────────────────────

/**
 * Parse a JSON Lines body. Blank lines are ignored; a line that is not a JSON
 * object is counted in `malformed` rather than failing the whole file.
 */
export function parseJsonl(text: string): { records: Record<string, unknown>[]; malformed: number } {
  const records: Record<string, unknown>[] = [];
  let malformed = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        records.push(parsed as Record<string, unknown>);
      } else {
        malformed++;
      }
    } catch {
      malformed++;
    }
  }
  return { records, malformed };
}

/**
 * The platform delivers events at least once, so the same `event_id` may
 * appear in more than one file. Keep the first occurrence; events without an
 * id are kept as-is (they cannot be matched).
 */
export function dedupeEvents<T extends ComplianceLogEnvelope>(
  events: readonly T[],
  seen: Set<string> = new Set(),
): { events: T[]; duplicates: number } {
  const out: T[] = [];
  let duplicates = 0;
  for (const event of events) {
    const id = asString(event.event_id);
    if (id) {
      if (seen.has(id)) {
        duplicates++;
        continue;
      }
      seen.add(id);
    }
    out.push(event);
  }
  return { events: out, duplicates };
}

// ─── Cursor rules ─────────────────────────────────────────────────────────

/**
 * Where a log stream should resume. `after` is exclusive on `end_time`, so
 * the stored watermark (the last processed file's `end_time`) is passed back
 * unchanged. Without a watermark the stream starts `initialLookbackDays` ago;
 * either way it never reaches past the platform's retention window.
 */
export function resolveLogCursor(input: {
  watermark: Date | null;
  now: Date;
  initialLookbackDays?: number;
  retentionDays?: number;
}): Date {
  const lookback = sanitizeDays(input.initialLookbackDays, CHATGPT_LOG_INITIAL_LOOKBACK_DAYS);
  const retention = sanitizeDays(input.retentionDays, CHATGPT_LOG_RETENTION_DAYS);
  const retentionFloor = new Date(input.now.getTime() - retention * DAY_MS);
  const lookbackStart = new Date(input.now.getTime() - lookback * DAY_MS);
  const candidate = input.watermark ?? lookbackStart;
  const floored = candidate < retentionFloor ? retentionFloor : candidate;
  // A watermark in the future (clock skew) must not skip everything new.
  return floored > input.now ? input.now : floored;
}

/**
 * Which files to download this run, in `end_time` order, honouring the
 * per-run file and byte caps. `truncated` means later files exist and the
 * next run must continue from `nextWatermark`; the watermark only advances
 * over files that were actually processed so nothing is skipped.
 */
export function planLogFileBatch(
  files: readonly ChatGPTLogFileMetadata[],
  options: { maxFiles?: number; maxBytes?: number } = {},
): { files: ChatGPTLogFileMetadata[]; truncated: boolean; nextWatermark: Date | null } {
  const maxFiles = sanitizeCount(options.maxFiles, CHATGPT_LOG_MAX_FILES_PER_RUN);
  const maxBytes = sanitizeCount(options.maxBytes, CHATGPT_LOG_MAX_BYTES_PER_RUN);
  const sorted = [...files]
    .filter((f) => typeof f?.id === "string" && typeof f?.end_time === "string")
    .sort((a, b) => a.end_time.localeCompare(b.end_time));

  const selected: ChatGPTLogFileMetadata[] = [];
  let bytes = 0;
  for (const file of sorted) {
    const size = Math.max(0, asNumber(file.file_size));
    const overFiles = selected.length >= maxFiles;
    const overBytes = selected.length > 0 && bytes + size > maxBytes;
    if (overFiles || overBytes) break;
    selected.push(file);
    bytes += size;
  }
  const truncated = selected.length < sorted.length;
  const last = selected[selected.length - 1];
  const nextWatermark = last ? new Date(last.end_time) : null;
  return {
    files: selected,
    truncated,
    nextWatermark: nextWatermark && !Number.isNaN(nextWatermark.getTime()) ? nextWatermark : null,
  };
}

/** The watermark after a run: never moves backwards. */
export function advanceStreamWatermark(
  existing: { watermark: Date; earliest: Date } | null,
  processedThrough: Date | null,
  windowStart: Date,
): { watermark: Date; earliest: Date } | null {
  if (!processedThrough) return existing;
  if (!existing) return { watermark: processedThrough, earliest: windowStart };
  return {
    watermark: processedThrough > existing.watermark ? processedThrough : existing.watermark,
    earliest: windowStart < existing.earliest ? windowStart : existing.earliest,
  };
}

function sanitizeDays(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function sanitizeCount(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

// ─── ComplianceActivity rows (AUTH_LOG + AUDIT_LOG) ───────────────────────

export interface ComplianceActivityValues {
  id: string;
  provider: "openai";
  type: string;
  occurredAt: Date;
  organizationId: string | null;
  actorType: string | null;
  actorEmail: string | null;
  actorUserId: string | null;
  actorApiKeyId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  payload: Record<string, unknown>;
}

/**
 * Map one AUTH_LOG or AUDIT_LOG event to a ComplianceActivity row. Returns
 * null for events missing an id or timestamp. The payload keeps the
 * envelope's identity fields and the action data; nothing else.
 */
export function complianceActivityFromEvent(
  event: ComplianceLogEnvelope,
  category: "AUTH_LOG" | "AUDIT_LOG",
  fallbackWorkspaceId: string | null,
): ComplianceActivityValues | null {
  const id = asString(event.event_id);
  const occurredAt = eventTimestamp(event);
  if (!id || !occurredAt) return null;

  const actor = normalizeActor(event);
  const requestMetadata = asRecord(event.request_metadata);
  const actionData = asRecord(event.action_data);
  const principal = asRecord(event.principal);

  const action =
    category === "AUTH_LOG"
      ? asString(actionData.action) ?? "unknown"
      : asString(event.action) ?? "unknown";
  const type = `${category.toLowerCase()}:${action}`;

  const payload: Record<string, unknown> =
    category === "AUTH_LOG"
      ? {
          event_type: category,
          principal,
          actor: asRecord(event.actor),
          request_metadata: requestMetadata,
          action_data: actionData,
        }
      : {
          event_type: category,
          principal,
          actor: asRecord(event.actor),
          action: asString(event.action),
          action_result: asString(event.action_result),
          action_privilege: asString(event.action_privilege),
          request_metadata: requestMetadata,
          action_data: actionData,
        };

  return {
    id,
    provider: "openai",
    type,
    occurredAt,
    organizationId: asString(principal.id) ?? fallbackWorkspaceId,
    actorType: actor.type,
    actorEmail: actor.email,
    actorUserId: actor.userId,
    actorApiKeyId: actor.apiKeyId,
    ipAddress: asString(requestMetadata.client_ip),
    userAgent: asString(requestMetadata.client_user_agent),
    payload,
  };
}

// ─── CONVERSATION_MESSAGE → per-user daily counts ─────────────────────────

export interface ChatGPTDailyCounts {
  /** Lower-cased actor email, or `user:<id>` when the event has no email. */
  actorExternalId: string;
  email: string | null;
  day: string;
  userMessages: number;
  assistantMessages: number;
  /** Distinct conversation ids seen in this batch. */
  conversations: number;
  gptConversations: number;
  projectConversations: number;
  /** Assistant messages per model. */
  models: Record<string, number>;
  /** User messages per client surface (desktop_web, ios_app, ...). */
  clientTypes: Record<string, number>;
  /** Distinct GPT ids used. */
  gpts: number;
}

interface ChatGPTDailyAccumulator extends Omit<ChatGPTDailyCounts, "conversations" | "gpts" | "gptConversations" | "projectConversations"> {
  conversationIds: Set<string>;
  gptConversationIds: Set<string>;
  projectConversationIds: Set<string>;
  gptIds: Set<string>;
}

function actorKey(actor: NormalizedActor): string | null {
  if (actor.email) return actor.email;
  if (actor.userId) return `user:${actor.userId}`;
  return null;
}

/**
 * Count messages per (actor, UTC day). Only counts and identifiers are read:
 * `message.author.type`, `author.model`, `author.client_type`,
 * `conversation.id/gpt_id/project_id`. Content is never touched.
 */
export function aggregateConversationMessages(
  events: readonly ComplianceLogEnvelope[],
): ChatGPTDailyCounts[] {
  const byKey = new Map<string, ChatGPTDailyAccumulator>();
  for (const event of events) {
    const day = eventDay(event);
    const actor = normalizeActor(event);
    const key = actorKey(actor);
    if (!day || !key) continue;

    const message = asRecord(event.message);
    const author = asRecord(message.author);
    const conversation = asRecord(event.conversation);
    const authorType = asString(author.type);

    const k = `${key}|${day}`;
    let agg = byKey.get(k);
    if (!agg) {
      agg = {
        actorExternalId: key,
        email: actor.email,
        day,
        userMessages: 0,
        assistantMessages: 0,
        models: {},
        clientTypes: {},
        conversationIds: new Set(),
        gptConversationIds: new Set(),
        projectConversationIds: new Set(),
        gptIds: new Set(),
      };
      byKey.set(k, agg);
    }

    if (authorType === "assistant") {
      agg.assistantMessages++;
      const model = asString(author.model) ?? "unknown";
      agg.models[model] = (agg.models[model] ?? 0) + 1;
    } else {
      // `user` and any future human-side variant count as a request.
      agg.userMessages++;
      const client = asString(author.client_type) ?? "unknown";
      agg.clientTypes[client] = (agg.clientTypes[client] ?? 0) + 1;
    }

    const conversationId = asString(conversation.id);
    if (conversationId) {
      agg.conversationIds.add(conversationId);
      if (asString(conversation.gpt_id)) agg.gptConversationIds.add(conversationId);
      if (asString(conversation.project_id)) agg.projectConversationIds.add(conversationId);
    }
    const gptId = asString(conversation.gpt_id);
    if (gptId) agg.gptIds.add(gptId);
  }

  return [...byKey.values()]
    .map((agg) => ({
      actorExternalId: agg.actorExternalId,
      email: agg.email,
      day: agg.day,
      userMessages: agg.userMessages,
      assistantMessages: agg.assistantMessages,
      conversations: agg.conversationIds.size,
      gptConversations: agg.gptConversationIds.size,
      projectConversations: agg.projectConversationIds.size,
      models: agg.models,
      clientTypes: agg.clientTypes,
      gpts: agg.gptIds.size,
    }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.actorExternalId.localeCompare(b.actorExternalId));
}

// ─── CODEX_LOG + CODEX_TURN → per-user daily counts ───────────────────────

export interface CodexTokenTotals {
  input: number;
  output: number;
  cachedInput: number;
  reasoningOutput: number;
}

export interface CodexDailyCounts {
  actorExternalId: string;
  email: string | null;
  day: string;
  /** PROMPT_SENT events. */
  prompts: number;
  /** PROMPT_RESPONSE_RECEIVED events. */
  responses: number;
  /** Distinct session ids across log and turn events. */
  sessions: number;
  toolCallsCompleted: number;
  toolCallsFailed: number;
  toolDecisionsApproved: number;
  toolDecisionsDenied: number;
  /** CODEX_TURN events. */
  turns: number;
  /** Tokens, preferring CODEX_TURN totals when any turn was seen. */
  tokens: CodexTokenTotals;
  tokenSource: "codex_turn" | "codex_log" | null;
  /** USD from CODEX_TURN `cost_usd` + `estimated_cost_usd`; null when no turn carried either. */
  costUsd: number | null;
  credits: number | null;
  /** Events per normalized client id (CODEX_CLI, CODEX_IDE_VSCODE, ...). */
  clients: Record<string, number>;
  /** Responses/turns per model. */
  models: Record<string, number>;
}

interface CodexDailyAccumulator
  extends Omit<CodexDailyCounts, "sessions" | "tokens" | "tokenSource" | "costUsd" | "credits"> {
  sessionIds: Set<string>;
  logTokens: CodexTokenTotals;
  turnTokens: CodexTokenTotals;
  costUsd: number | null;
  credits: number | null;
}

const DENIED_DECISIONS = new Set(["denied", "denied_with_network_policy_deny", "timed_out", "abort"]);

function getOrCreateCodex(byKey: Map<string, CodexDailyAccumulator>, key: string, email: string | null, day: string) {
  const k = `${key}|${day}`;
  let agg = byKey.get(k);
  if (!agg) {
    agg = {
      actorExternalId: key,
      email,
      day,
      prompts: 0,
      responses: 0,
      toolCallsCompleted: 0,
      toolCallsFailed: 0,
      toolDecisionsApproved: 0,
      toolDecisionsDenied: 0,
      turns: 0,
      clients: {},
      models: {},
      sessionIds: new Set(),
      logTokens: { input: 0, output: 0, cachedInput: 0, reasoningOutput: 0 },
      turnTokens: { input: 0, output: 0, cachedInput: 0, reasoningOutput: 0 },
      costUsd: null,
      credits: null,
    };
    byKey.set(k, agg);
  }
  return agg;
}

/**
 * Aggregate Codex activity per (actor, UTC day). From CODEX_LOG only the
 * sub-event type, session id, model, client id, tool status/decision and
 * `token_usage` are read; `prompt_text`, `response_text` and `tool_input` are
 * never touched. CODEX_TURN supplies tokens and cost per turn.
 */
export function aggregateCodexEvents(
  logEvents: readonly ComplianceLogEnvelope[],
  turnEvents: readonly ComplianceLogEnvelope[],
): CodexDailyCounts[] {
  const byKey = new Map<string, CodexDailyAccumulator>();

  for (const event of logEvents) {
    const day = eventDay(event);
    const actor = normalizeActor(event);
    const key = actorKey(actor);
    if (!day || !key) continue;
    const agg = getOrCreateCodex(byKey, key, actor.email, day);

    const subType = asString(event.event_type) ?? "UNKNOWN";
    const details = asRecord(event.event_details);
    const client = asString(event.client_id);
    if (client) agg.clients[client] = (agg.clients[client] ?? 0) + 1;
    const sessionId = asString(details.session_id);
    if (sessionId) agg.sessionIds.add(sessionId);

    switch (subType) {
      case "PROMPT_SENT":
        agg.prompts++;
        break;
      case "PROMPT_RESPONSE_RECEIVED": {
        agg.responses++;
        const model = asString(details.model) ?? "unknown";
        agg.models[model] = (agg.models[model] ?? 0) + 1;
        const usage = asRecord(details.token_usage);
        agg.logTokens.input += asNumber(usage.input_tokens);
        agg.logTokens.output += asNumber(usage.output_tokens);
        agg.logTokens.cachedInput += asNumber(usage.cached_input_tokens);
        agg.logTokens.reasoningOutput += asNumber(usage.reasoning_output_tokens);
        break;
      }
      case "TOOL_CALL_COMPLETED":
        agg.toolCallsCompleted++;
        break;
      case "TOOL_CALL_FAILED":
        agg.toolCallsFailed++;
        break;
      case "TOOL_DECISION": {
        const decision = asString(details.decision) ?? "";
        if (DENIED_DECISIONS.has(decision)) agg.toolDecisionsDenied++;
        else if (decision.startsWith("approved")) agg.toolDecisionsApproved++;
        break;
      }
      default:
        break;
    }
  }

  for (const event of turnEvents) {
    const day = eventDay(event);
    const actor = normalizeActor(event);
    const key = actorKey(actor);
    if (!day || !key) continue;
    const agg = getOrCreateCodex(byKey, key, actor.email, day);
    const payload = asRecord(event.payload);

    agg.turns++;
    const client = asString(payload.product_client_id);
    if (client) agg.clients[client] = (agg.clients[client] ?? 0) + 1;
    const model = asString(payload.model);
    if (model) agg.models[model] = (agg.models[model] ?? 0) + 1;
    const sessionId = asString(payload.session_id) ?? asString(payload.thread_id);
    if (sessionId) agg.sessionIds.add(sessionId);

    const usage = asRecord(payload.token_usage);
    const cached = asNumber(usage.cached_input_tokens);
    agg.turnTokens.input += asNumber(usage.uncached_input_tokens) + cached;
    agg.turnTokens.cachedInput += cached;
    agg.turnTokens.output += asNumber(usage.output_tokens);

    const costUsd = payload.cost_usd;
    const estimated = payload.estimated_cost_usd;
    if (typeof costUsd === "number" || typeof estimated === "number") {
      agg.costUsd = (agg.costUsd ?? 0) + asNumber(costUsd) + asNumber(estimated);
    }
    if (typeof payload.credits === "number") {
      agg.credits = (agg.credits ?? 0) + asNumber(payload.credits);
    }
  }

  return [...byKey.values()]
    .map((agg) => {
      const useTurns = agg.turns > 0;
      const tokens = useTurns ? agg.turnTokens : agg.logTokens;
      const hasLogTokens =
        agg.logTokens.input + agg.logTokens.output + agg.logTokens.cachedInput + agg.logTokens.reasoningOutput > 0;
      return {
        actorExternalId: agg.actorExternalId,
        email: agg.email,
        day: agg.day,
        prompts: agg.prompts,
        responses: agg.responses,
        sessions: agg.sessionIds.size,
        toolCallsCompleted: agg.toolCallsCompleted,
        toolCallsFailed: agg.toolCallsFailed,
        toolDecisionsApproved: agg.toolDecisionsApproved,
        toolDecisionsDenied: agg.toolDecisionsDenied,
        turns: agg.turns,
        tokens,
        tokenSource: useTurns ? "codex_turn" : hasLogTokens ? "codex_log" : null,
        costUsd: agg.costUsd,
        credits: agg.credits,
        clients: agg.clients,
        models: agg.models,
      } satisfies CodexDailyCounts;
    })
    .sort((a, b) => a.day.localeCompare(b.day) || a.actorExternalId.localeCompare(b.actorExternalId));
}

// ─── Alert detection ──────────────────────────────────────────────────────

export const CHATGPT_ADMIN_ROLES = new Set(["account-owner", "account-admin"]);

export function isChatGPTAdminRole(role: string | null | undefined): boolean {
  return !!role && CHATGPT_ADMIN_ROLES.has(role.toLowerCase());
}

export interface AdminRoleGrant {
  userId: string;
  email: string | null;
  previousRole: string | null;
  newRole: string;
}

/**
 * Users whose role became an admin role since the previous sync. `previous`
 * maps user id → last-seen role; a user with no previous record (first sync,
 * or a brand-new member) is not reported as a grant — the first sync is a
 * baseline, and new admins arriving via invite show up through the audit
 * feed instead.
 */
export function detectAdminRoleGrants(
  previous: ReadonlyMap<string, string | null>,
  users: readonly ChatGPTWorkspaceUser[],
): AdminRoleGrant[] {
  const grants: AdminRoleGrant[] = [];
  for (const user of users) {
    const id = asString(user.id);
    const role = asString(user.role);
    if (!id || !role || !isChatGPTAdminRole(role)) continue;
    if (!previous.has(id)) continue;
    const previousRole = previous.get(id) ?? null;
    if (isChatGPTAdminRole(previousRole)) continue;
    grants.push({
      userId: id,
      email: asString(user.email)?.toLowerCase() ?? null,
      previousRole,
      newRole: role,
    });
  }
  return grants;
}

export interface AdminRoleAuditGrant {
  eventId: string | null;
  occurredAt: Date | null;
  action: string;
  /** Who performed the change. */
  actorEmail: string | null;
  /** Who received the role, when the action carries it. */
  targetUserId: string | null;
  targetEmails: string[];
  role: string;
}

/**
 * AUDIT_LOG events that grant a workspace admin role: `USER_ROLE_UPDATED`
 * with an admin `role`, and `INVITE_USERS` / `INVITE_UPDATE` carrying an
 * admin role. Blocked or errored actions are ignored.
 */
export function detectAdminRoleAuditGrants(
  auditEvents: readonly ComplianceLogEnvelope[],
): AdminRoleAuditGrant[] {
  const grants: AdminRoleAuditGrant[] = [];
  for (const event of auditEvents) {
    const action = asString(event.action);
    if (!action) continue;
    const result = asString(event.action_result);
    if (result && result !== "SUCCESS") continue;
    if (action !== "USER_ROLE_UPDATED" && action !== "INVITE_USERS" && action !== "INVITE_UPDATE") continue;

    const data = asRecord(event.action_data);
    const role = asString(data.role);
    if (!isChatGPTAdminRole(role)) continue;

    const emails: string[] = [];
    if (Array.isArray(data.email_addresses)) {
      for (const e of data.email_addresses) {
        const s = asString(e);
        if (s) emails.push(s.toLowerCase());
      }
    }
    const single = asString(data.email_address);
    if (single) emails.push(single.toLowerCase());

    grants.push({
      eventId: asString(event.event_id),
      occurredAt: eventTimestamp(event),
      action,
      actorEmail: normalizeActor(event).email,
      targetUserId: asString(data.user_id),
      targetEmails: emails,
      role: role!,
    });
  }
  return grants;
}

export interface GptWithActions {
  gptId: string;
  name: string | null;
  ownerEmail: string | null;
  visibility: string | null;
  /** When the GPT, or the configuration that added the action, was created. */
  createdAt: Date;
  actionDomains: string[];
  authTypes: string[];
}

/** Newest instant a GPT or its latest configuration was created. */
export function gptEffectiveCreatedAt(gpt: ChatGPTWorkspaceGpt): Date | null {
  const candidates: Date[] = [];
  const created = unixSecondsToDate(gpt.created_at);
  if (created) candidates.push(created);
  const configs = Array.isArray(gpt.latest_config?.data) ? gpt.latest_config!.data! : [];
  for (const config of configs) {
    const c = unixSecondsToDate(config.created_at);
    if (c) candidates.push(c);
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b > a ? b : a));
}

/**
 * GPTs whose latest configuration includes a `custom_action` tool and whose
 * effective creation time is after `since` (exclusive). With `since` null
 * (first sync) nothing is reported: that run establishes the baseline.
 */
export function detectGptsWithActions(
  gpts: readonly ChatGPTWorkspaceGpt[],
  since: Date | null,
): GptWithActions[] {
  if (!since) return [];
  const hits: GptWithActions[] = [];
  for (const gpt of gpts) {
    const id = asString(gpt.id);
    if (!id) continue;
    const createdAt = gptEffectiveCreatedAt(gpt);
    if (!createdAt || createdAt <= since) continue;

    const configs = Array.isArray(gpt.latest_config?.data) ? gpt.latest_config!.data! : [];
    const domains = new Set<string>();
    const authTypes = new Set<string>();
    let hasAction = false;
    let name: string | null = null;
    for (const config of configs) {
      name ??= asString(config.name);
      const tools = Array.isArray(config.tools?.data) ? config.tools!.data! : [];
      for (const tool of tools) {
        if (asString(tool.type) !== "custom_action") continue;
        hasAction = true;
        const domain = asString(tool.action_domain);
        if (domain) domains.add(domain.toLowerCase());
        const auth = asString(tool.auth_type);
        if (auth) authTypes.add(auth);
      }
    }
    if (!hasAction) continue;
    hits.push({
      gptId: id,
      name,
      ownerEmail: asString(gpt.owner_email)?.toLowerCase() ?? null,
      visibility: asString(gpt.sharing?.visibility),
      createdAt,
      actionDomains: [...domains].sort(),
      authTypes: [...authTypes].sort(),
    });
  }
  return hits.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** The GPTS watermark after a run: newest effective creation time seen. */
export function latestGptCreatedAt(gpts: readonly ChatGPTWorkspaceGpt[]): Date | null {
  let latest: Date | null = null;
  for (const gpt of gpts) {
    const d = gptEffectiveCreatedAt(gpt);
    if (d && (!latest || d > latest)) latest = d;
  }
  return latest;
}

/**
 * A workspace GPT as a DiscoveredAgent (source `chatgpt_gpts`, externalId =
 * GPT id). Carries the owner, the tool types of its latest configuration
 * (`custom_action:<domain>` for each external action) and sharing metadata.
 * Never instructions, conversation starters or knowledge files.
 */
export function gptToDiscoveredAgent(
  gpt: ChatGPTWorkspaceGpt,
  options: { suppressAlert?: boolean } = {},
): DiscoveredAgentInput | null {
  const id = asString(gpt.id);
  if (!id) return null;
  const configs = Array.isArray(gpt.latest_config?.data) ? gpt.latest_config!.data! : [];
  let name: string | null = null;
  let description: string | null = null;
  const tools: string[] = [];
  const actionDomains = new Set<string>();
  const authTypes = new Set<string>();
  const authors = new Set<string>();
  for (const config of configs) {
    name ??= asString(config.name);
    description ??= asString(config.description);
    const author = asString(config.version_author?.email)?.toLowerCase();
    if (author) authors.add(author);
    const configTools = Array.isArray(config.tools?.data) ? config.tools!.data! : [];
    for (const tool of configTools) {
      const type = asString(tool.type);
      if (!type) continue;
      if (type === "custom_action") {
        const domain = asString(tool.action_domain)?.toLowerCase() ?? null;
        if (domain) actionDomains.add(domain);
        const auth = asString(tool.auth_type);
        if (auth) authTypes.add(auth);
        tools.push(domain ? `custom_action:${domain}` : "custom_action");
      } else {
        tools.push(type);
      }
    }
  }
  const ownerEmail = asString(gpt.owner_email)?.toLowerCase() ?? null;
  return {
    source: "chatgpt_gpts",
    externalId: id,
    name: name ?? asString(gpt.builder_name) ?? id,
    description,
    platform: "ChatGPT Enterprise",
    framework: "custom-gpt",
    confidence: "high",
    tools,
    ownerEmail,
    userEmails: [...new Set([ownerEmail, ...authors].filter((e): e is string => !!e))],
    firstSeenAt: unixSecondsToDate(gpt.created_at),
    lastSeenAt: new Date(),
    suppressAlert: options.suppressAlert,
    metadata: {
      gptId: id,
      visibility: asString(gpt.sharing?.visibility),
      builderName: asString(gpt.builder_name),
      actionDomains: [...actionDomains].sort(),
      authTypes: [...authTypes].sort(),
      configUpdatedAt: gptEffectiveCreatedAt(gpt)?.toISOString() ?? null,
    },
  };
}

// ─── Users → ProviderActor values ─────────────────────────────────────────

export interface ChatGPTActorValues {
  externalId: string;
  email: string | null;
  name: string | null;
  role: string | null;
  status: string | null;
  createdAt: Date | null;
}

export function normalizeWorkspaceUser(user: ChatGPTWorkspaceUser): ChatGPTActorValues | null {
  const id = asString(user.id);
  if (!id) return null;
  const email = asString(user.email)?.toLowerCase() ?? null;
  return {
    externalId: id,
    email,
    name: asString(user.name) ?? (email ? email.split("@")[0] : null),
    role: asString(user.role),
    status: asString(user.status),
    createdAt: unixSecondsToDate(user.created_at),
  };
}

/** Users created after `since` (exclusive); nothing on the first sync. */
export function detectNewWorkspaceUsers(
  users: readonly ChatGPTWorkspaceUser[],
  since: Date | null,
): ChatGPTActorValues[] {
  if (!since) return [];
  const out: ChatGPTActorValues[] = [];
  for (const user of users) {
    const normalized = normalizeWorkspaceUser(user);
    if (!normalized?.createdAt || normalized.createdAt <= since) continue;
    out.push(normalized);
  }
  return out;
}
