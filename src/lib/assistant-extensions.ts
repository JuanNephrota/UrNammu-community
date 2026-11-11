// Assistant extension inventory — what each coding assistant has loaded, per
// person, derived from the OTel stream rather than from the endpoint agent.
//
// Claude Code announces its extension surface in its own events:
//   plugin_loaded          once per enabled plugin at session start
//   plugin_installed       the install action itself
//   hook_registered        once per configured hook at session start
//   mcp_server_connection  every connect / disconnect / failure
//   skill_activated        every skill invocation (Skill tool or slash command)
//   subagent_completed     every subagent run
// Cursor's OTel hook names the MCP server on its beforeMCPExecution /
// afterMCPExecution spans.
//
// Everything here works on identifiers and provenance only. Arguments, prompts,
// hook commands and paths are stripped at the collector and again on ingest
// before these extractors ever see a row.
//
// Claude Code redacts third-party plugin names to "third-party", user skills
// to "custom_skill", custom agents to "custom", and omits MCP server names
// altogether unless OTEL_LOG_TOOL_DETAILS=1 is set in managed settings. Rows
// built from such placeholders carry `redacted: true` so the console can say
// "three third-party plugins" without pretending to know which ones.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { str, bool } from "@/lib/validations/otlp-shared";

export type ExtensionClient = "claude_code" | "cursor";
export type ExtensionKind = "plugin" | "mcp_server" | "skill" | "hook" | "agent";

export const EXTENSION_KINDS: ExtensionKind[] = ["plugin", "mcp_server", "skill", "hook", "agent"];
export const EXTENSION_CLIENTS: ExtensionClient[] = ["claude_code", "cursor"];

export const EXTENSION_KIND_LABELS: Record<ExtensionKind, string> = {
  plugin: "Plugin",
  mcp_server: "MCP server",
  skill: "Skill",
  hook: "Hook",
  agent: "Subagent",
};

export const EXTENSION_CLIENT_LABELS: Record<ExtensionClient, string> = {
  claude_code: "Claude Code",
  cursor: "Cursor",
};

/** Claude Code event names that describe the extension surface. */
export const CLAUDE_CODE_EXTENSION_EVENTS = new Set([
  "plugin_loaded",
  "plugin_installed",
  "hook_registered",
  "mcp_server_connection",
  "skill_activated",
  "subagent_completed",
]);

/** Cursor hook events whose spans name an MCP server. */
export const CURSOR_MCP_HOOK_EVENTS = new Set(["beforeMCPExecution", "afterMCPExecution"]);

/** Placeholder names Claude Code substitutes when detailed logging is off. */
const REDACTED_NAMES = new Set(["third-party", "custom_skill", "custom", "mcp_tool"]);

/** Cap on the distinct Cursor tool names kept per server row. */
const MAX_TOOLS_PER_SERVER = 100;

// ─── Inputs ──────────────────────────────────────────────
// Structural subsets of FlattenedEvent / FlattenedSpan and of the persisted
// ClaudeCodeEvent / CursorSpan rows, so the same extractors serve live ingest
// and the historical backfill.

export interface ExtensionEventInput {
  eventName: string;
  timestamp: Date;
  sessionId: string | null;
  userId: string | null;
  userEmail: string | null;
  appVersion: string | null;
  attributes: unknown;
}

export interface ExtensionSpanInput {
  hookEvent: string | null;
  timestamp: Date;
  sessionId: string | null;
  userId: string | null;
  userEmail: string | null;
  appVersion: string | null;
  genAiToolName: string | null;
  success: boolean | null;
  attributes: unknown;
}

export interface ExtensionObservation {
  client: ExtensionClient;
  userEmail: string;
  userId: string | null;
  kind: ExtensionKind;
  key: string;
  name: string;
  redacted: boolean;
  source: string | null;
  marketplace: string | null;
  pluginName: string | null;
  pluginIdHash: string | null;
  version: string | null;
  transport: string | null;
  status: string | null;
  enabledVia: string | null;
  failed: boolean;
  detail: Record<string, unknown>;
  sessionId: string | null;
  appVersion: string | null;
  seenAt: Date;
}

function attrs(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function normalizeEmail(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

function isRedacted(name: string | null): boolean {
  return name === null || REDACTED_NAMES.has(name);
}

function base(
  client: ExtensionClient,
  row: { userEmail: string | null; userId: string | null; sessionId: string | null; appVersion: string | null; timestamp: Date },
): Pick<ExtensionObservation, "client" | "userEmail" | "userId" | "sessionId" | "appVersion" | "seenAt"> {
  return {
    client,
    userEmail: normalizeEmail(row.userEmail),
    userId: row.userId,
    sessionId: row.sessionId,
    appVersion: row.appVersion,
    seenAt: row.timestamp,
  };
}

// ─── Claude Code ─────────────────────────────────────────

/** Pure: turn one Claude Code event into an observation, or null. */
export function extractClaudeCodeExtension(row: ExtensionEventInput): ExtensionObservation | null {
  if (!CLAUDE_CODE_EXTENSION_EVENTS.has(row.eventName)) return null;
  const a = attrs(row.attributes);
  const pluginName = str(a["plugin.name"]);
  const marketplace = str(a["marketplace.name"]);
  const pluginIdHash = str(a["plugin_id_hash"]);
  const common = base("claude_code", row);

  switch (row.eventName) {
    case "plugin_loaded":
    case "plugin_installed": {
      const name = pluginName ?? "third-party";
      const redacted = isRedacted(name);
      const detail: Record<string, unknown> = {};
      if (row.eventName === "plugin_loaded") {
        const hasHooks = bool(a["has_hooks"]);
        const hasMcp = bool(a["has_mcp"]);
        if (hasHooks !== null) detail.hasHooks = hasHooks;
        if (hasMcp !== null) detail.hasMcp = hasMcp;
        for (const [attr, key] of [
          ["skill_path_count", "skillPaths"],
          ["command_path_count", "commandPaths"],
          ["agent_path_count", "agentPaths"],
        ] as const) {
          const n = Number(a[attr]);
          if (Number.isFinite(n) && a[attr] !== undefined && a[attr] !== null) detail[key] = n;
        }
      } else {
        const trigger = str(a["install.trigger"]);
        if (trigger) detail.installTrigger = trigger;
        detail.installed = true;
      }
      const official = str(a["marketplace.is_official"]) ?? (bool(a["marketplace.is_official"]) === true ? "true" : null);
      if (official !== null) detail.marketplaceOfficial = official === "true";
      return {
        ...common,
        kind: "plugin",
        // The hash survives the redacted → named transition when detailed
        // logging is switched on, so prefer it as the merge identity.
        key: pluginIdHash ? `hash:${pluginIdHash}` : `${name}@${marketplace ?? "unknown"}`,
        name,
        redacted,
        source: str(a["plugin.scope"]),
        marketplace,
        pluginName: null,
        pluginIdHash,
        version: str(a["plugin.version"]),
        transport: null,
        status: null,
        enabledVia: str(a["enabled_via"]),
        failed: false,
        detail,
      };
    }

    case "mcp_server_connection": {
      const serverName = str(a["server_name"]);
      const isPlugin = bool(a["is_plugin"]) === true;
      const transport = str(a["transport_type"]);
      const scope = str(a["server_scope"]);
      const status = str(a["status"]);
      const name = serverName
        ? serverName
        : isPlugin
          ? `${pluginName && !isRedacted(pluginName) ? pluginName : "third-party"} plugin server`
          : "Unnamed server";
      const key = serverName
        ? `server:${serverName}`
        : isPlugin
          ? `plugin:${pluginIdHash ?? pluginName ?? "unknown"}`
          : `unnamed:${transport ?? "unknown"}:${scope ?? "unknown"}`;
      const detail: Record<string, unknown> = { isPlugin };
      const errorCode = str(a["error_code"]);
      if (status === "failed" && errorCode) detail.lastErrorCode = errorCode;
      return {
        ...common,
        kind: "mcp_server",
        key,
        name,
        redacted: !serverName,
        source: scope,
        marketplace: isPlugin ? marketplace : null,
        pluginName: isPlugin ? pluginName : null,
        pluginIdHash: isPlugin ? pluginIdHash : null,
        version: null,
        transport,
        status,
        enabledVia: null,
        failed: status === "failed",
        detail,
      };
    }

    case "skill_activated": {
      const name = str(a["skill.name"]) ?? "custom_skill";
      const source = str(a["skill.source"]);
      const detail: Record<string, unknown> = {};
      const trigger = str(a["invocation_trigger"]);
      if (trigger) detail.lastTrigger = trigger;
      if (str(a["skill.kind"]) === "workflow") detail.workflow = true;
      return {
        ...common,
        kind: "skill",
        key: `${source ?? "unknown"}:${pluginName ? `${pluginName}:` : ""}${name}`,
        name,
        redacted: isRedacted(name),
        source,
        marketplace,
        pluginName,
        pluginIdHash,
        version: null,
        transport: null,
        status: null,
        enabledVia: null,
        failed: false,
        detail,
      };
    }

    case "hook_registered": {
      const hookEvent = str(a["hook_event"]) ?? "unknown";
      const hookType = str(a["hook_type"]) ?? "command";
      const source = str(a["hook_source"]);
      const detail: Record<string, unknown> = { hookEvent, hookType };
      const matcher = str(a["hook_matcher"]);
      if (matcher) detail.matcher = matcher;
      return {
        ...common,
        kind: "hook",
        key: `${source ?? "unknown"}:${hookEvent}:${hookType}:${pluginIdHash ?? pluginName ?? ""}`,
        name: `${hookEvent} (${hookType})`,
        redacted: source === "pluginHook" && isRedacted(pluginName),
        source,
        marketplace,
        pluginName,
        pluginIdHash,
        version: null,
        transport: null,
        status: null,
        enabledVia: null,
        failed: false,
        detail,
      };
    }

    case "subagent_completed": {
      const name = str(a["agent_type"]) ?? "custom";
      const source = str(a["agent.source"]);
      const detail: Record<string, unknown> = {};
      const builtIn = bool(a["is_built_in"]);
      if (builtIn !== null) detail.builtIn = builtIn;
      return {
        ...common,
        kind: "agent",
        key: `${source ?? "unknown"}:${name}`,
        name,
        redacted: isRedacted(name),
        source,
        marketplace,
        pluginName,
        pluginIdHash,
        version: null,
        transport: null,
        status: null,
        enabledVia: null,
        failed: false,
        detail,
      };
    }
  }
  return null;
}

export function extractClaudeCodeExtensions(rows: ExtensionEventInput[]): ExtensionObservation[] {
  const out: ExtensionObservation[] = [];
  for (const row of rows) {
    const obs = extractClaudeCodeExtension(row);
    if (obs) out.push(obs);
  }
  return out;
}

// ─── Cursor ──────────────────────────────────────────────

/** Pure: turn one Cursor MCP span into an observation, or null. */
export function extractCursorExtension(row: ExtensionSpanInput): ExtensionObservation | null {
  if (!row.hookEvent || !CURSOR_MCP_HOOK_EVENTS.has(row.hookEvent)) return null;
  const a = attrs(row.attributes);
  // The hook writes gen_ai.tool.name as "<server>.<tool>" and also carries the
  // server on its own under langsmith.metadata.mcp_server.
  let server = str(a["langsmith.metadata.mcp_server"]);
  let tool = str(a["langsmith.metadata.mcp_tool"]);
  if ((!server || !tool) && row.genAiToolName) {
    const dot = row.genAiToolName.indexOf(".");
    if (dot > 0) {
      server ??= row.genAiToolName.slice(0, dot);
      tool ??= row.genAiToolName.slice(dot + 1);
    } else {
      tool ??= row.genAiToolName;
    }
  }
  if (!server) return null;
  const after = row.hookEvent === "afterMCPExecution";
  const detail: Record<string, unknown> = {};
  if (tool) detail.tools = [tool];
  return {
    ...base("cursor", row),
    userEmail: normalizeEmail(row.userEmail ?? str(a["langsmith.metadata.user_email"])),
    kind: "mcp_server",
    key: `server:${server}`,
    name: server,
    redacted: false,
    source: null,
    marketplace: null,
    pluginName: null,
    pluginIdHash: null,
    version: null,
    transport: null,
    status: after ? (row.success === false ? "failed" : "connected") : null,
    enabledVia: null,
    failed: after && row.success === false,
    detail,
  };
}

export function extractCursorExtensions(rows: ExtensionSpanInput[]): ExtensionObservation[] {
  const out: ExtensionObservation[] = [];
  for (const row of rows) {
    const obs = extractCursorExtension(row);
    if (obs) out.push(obs);
  }
  return out;
}

// ─── Aggregation ─────────────────────────────────────────

export interface ExtensionAggregate {
  client: ExtensionClient;
  userEmail: string;
  userId: string | null;
  kind: ExtensionKind;
  key: string;
  name: string;
  redacted: boolean;
  source: string | null;
  marketplace: string | null;
  pluginName: string | null;
  pluginIdHash: string | null;
  version: string | null;
  transport: string | null;
  lastStatus: string | null;
  enabledVia: string | null;
  detail: Record<string, unknown>;
  observations: number;
  sessionIds: Set<string>;
  failures: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastSessionId: string | null;
  lastAppVersion: string | null;
}

export function aggregateKey(o: { client: string; userEmail: string; kind: string; key: string }): string {
  return `${o.client}\u0000${o.userEmail}\u0000${o.kind}\u0000${o.key}`;
}

function mergeDetail(
  into: Record<string, unknown>,
  from: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...into, ...from };
  const a = Array.isArray(into.tools) ? (into.tools as unknown[]) : [];
  const b = Array.isArray(from.tools) ? (from.tools as unknown[]) : [];
  if (a.length || b.length) {
    const tools = new Set<string>();
    for (const t of [...a, ...b]) if (typeof t === "string") tools.add(t);
    out.tools = [...tools].sort().slice(0, MAX_TOOLS_PER_SERVER);
  }
  return out;
}

/**
 * Pure: fold observations into one aggregate per (client, person, kind,
 * key). Later observations win for mutable fields (name, status, version);
 * counts and session sets accumulate.
 */
export function aggregateExtensionObservations(observations: ExtensionObservation[]): ExtensionAggregate[] {
  const sorted = [...observations].sort((x, y) => x.seenAt.getTime() - y.seenAt.getTime());
  const map = new Map<string, ExtensionAggregate>();
  for (const o of sorted) {
    const k = aggregateKey(o);
    const existing = map.get(k);
    if (!existing) {
      map.set(k, {
        client: o.client,
        userEmail: o.userEmail,
        userId: o.userId,
        kind: o.kind,
        key: o.key,
        name: o.name,
        redacted: o.redacted,
        source: o.source,
        marketplace: o.marketplace,
        pluginName: o.pluginName,
        pluginIdHash: o.pluginIdHash,
        version: o.version,
        transport: o.transport,
        lastStatus: o.status,
        enabledVia: o.enabledVia,
        detail: { ...o.detail },
        observations: 1,
        sessionIds: new Set(o.sessionId ? [o.sessionId] : []),
        failures: o.failed ? 1 : 0,
        firstSeenAt: o.seenAt,
        lastSeenAt: o.seenAt,
        lastSessionId: o.sessionId,
        lastAppVersion: o.appVersion,
      });
      continue;
    }
    existing.observations += 1;
    if (o.sessionId) existing.sessionIds.add(o.sessionId);
    if (o.failed) existing.failures += 1;
    existing.lastSeenAt = o.seenAt;
    existing.lastSessionId = o.sessionId ?? existing.lastSessionId;
    existing.lastAppVersion = o.appVersion ?? existing.lastAppVersion;
    existing.userId = o.userId ?? existing.userId;
    // A named observation always beats a placeholder.
    if (!o.redacted || existing.redacted) {
      existing.name = o.name;
      existing.redacted = o.redacted;
    }
    existing.source = o.source ?? existing.source;
    existing.marketplace = o.marketplace ?? existing.marketplace;
    existing.pluginName = o.pluginName ?? existing.pluginName;
    existing.pluginIdHash = o.pluginIdHash ?? existing.pluginIdHash;
    existing.version = o.version ?? existing.version;
    existing.transport = o.transport ?? existing.transport;
    existing.lastStatus = o.status ?? existing.lastStatus;
    existing.enabledVia = o.enabledVia ?? existing.enabledVia;
    existing.detail = mergeDetail(existing.detail, o.detail);
  }
  return [...map.values()];
}

// ─── Persistence ─────────────────────────────────────────

export interface RecordExtensionsResult {
  observations: number;
  rows: number;
  created: number;
  updated: number;
}

const UPSERT_CHUNK = 100;

/**
 * Merge a batch of observations into AssistantExtension. Reads the existing
 * rows for the batch's keys first so detail (tool lists) unions and the
 * session count only grows when a session not already counted shows up.
 */
export async function recordExtensionObservations(
  observations: ExtensionObservation[],
): Promise<RecordExtensionsResult> {
  const aggregates = aggregateExtensionObservations(observations);
  if (aggregates.length === 0) {
    return { observations: observations.length, rows: 0, created: 0, updated: 0 };
  }

  const existing = new Map<string, Prisma.AssistantExtensionGetPayload<object>>();
  for (let i = 0; i < aggregates.length; i += UPSERT_CHUNK) {
    const chunk = aggregates.slice(i, i + UPSERT_CHUNK);
    const found = await prisma.assistantExtension.findMany({
      where: {
        OR: chunk.map((a) => ({
          client: a.client,
          userEmail: a.userEmail,
          kind: a.kind,
          key: a.key,
        })),
      },
    });
    for (const row of found) existing.set(aggregateKey(row), row);
  }

  let created = 0;
  let updated = 0;
  for (let i = 0; i < aggregates.length; i += UPSERT_CHUNK) {
    const chunk = aggregates.slice(i, i + UPSERT_CHUNK);
    await prisma.$transaction(
      chunk.map((a) => {
        const prev = existing.get(aggregateKey(a));
        if (prev) updated += 1;
        else created += 1;

        // Sessions already counted: the stored lastSessionId is the only one
        // we remember, so subtract it if the batch saw it again. Approximate
        // by design — exact distinct counts would need a sessions table.
        const newSessions = a.sessionIds.size - (prev?.lastSessionId && a.sessionIds.has(prev.lastSessionId) ? 1 : 0);
        const prevDetail = attrs(prev?.detail);
        const detail = mergeDetail(prevDetail, a.detail) as Prisma.InputJsonObject;
        const keepName = prev && !prev.redacted && a.redacted;

        return prisma.assistantExtension.upsert({
          where: {
            client_userEmail_kind_key: {
              client: a.client,
              userEmail: a.userEmail,
              kind: a.kind,
              key: a.key,
            },
          },
          create: {
            client: a.client,
            userEmail: a.userEmail,
            userId: a.userId,
            kind: a.kind,
            key: a.key,
            name: a.name,
            redacted: a.redacted,
            source: a.source,
            marketplace: a.marketplace,
            pluginName: a.pluginName,
            pluginIdHash: a.pluginIdHash,
            version: a.version,
            transport: a.transport,
            lastStatus: a.lastStatus,
            enabledVia: a.enabledVia,
            detail,
            observations: a.observations,
            sessions: a.sessionIds.size,
            failures: a.failures,
            firstSeenAt: a.firstSeenAt,
            lastSeenAt: a.lastSeenAt,
            lastSessionId: a.lastSessionId,
            lastAppVersion: a.lastAppVersion,
          },
          update: {
            userId: a.userId ?? undefined,
            name: keepName ? undefined : a.name,
            redacted: keepName ? undefined : a.redacted,
            source: a.source ?? undefined,
            marketplace: a.marketplace ?? undefined,
            pluginName: a.pluginName ?? undefined,
            pluginIdHash: a.pluginIdHash ?? undefined,
            version: a.version ?? undefined,
            transport: a.transport ?? undefined,
            lastStatus: a.lastStatus ?? undefined,
            enabledVia: a.enabledVia ?? undefined,
            detail,
            observations: { increment: a.observations },
            sessions: { increment: Math.max(newSessions, 0) },
            failures: { increment: a.failures },
            firstSeenAt: prev && prev.firstSeenAt < a.firstSeenAt ? undefined : a.firstSeenAt,
            lastSeenAt: prev && prev.lastSeenAt > a.lastSeenAt ? undefined : a.lastSeenAt,
            lastSessionId: a.lastSessionId ?? undefined,
            lastAppVersion: a.lastAppVersion ?? undefined,
          },
        });
      }),
    );
  }

  return { observations: observations.length, rows: aggregates.length, created, updated };
}

/**
 * Ingest-side pre-step: the collector re-sends a whole batch when an export
 * times out, and `createMany({ skipDuplicates })` only reports how many rows
 * it skipped, not which. Counting a re-sent batch again would double every
 * observation, so look up which extension-bearing rows are already stored
 * BEFORE the insert and hand back only the new ones. Only the rows the
 * inventory cares about are checked, so the lookup stays small.
 */
export async function selectUnseenClaudeCodeRows<T extends ExtensionEventInput & { dedupeKey: string }>(
  rows: T[],
): Promise<T[]> {
  const candidates = rows.filter((r) => CLAUDE_CODE_EXTENSION_EVENTS.has(r.eventName));
  if (candidates.length === 0) return [];
  const stored = await prisma.claudeCodeEvent.findMany({
    where: { dedupeKey: { in: candidates.map((r) => r.dedupeKey) } },
    select: { dedupeKey: true },
  });
  const seen = new Set(stored.map((r) => r.dedupeKey));
  return candidates.filter((r) => !seen.has(r.dedupeKey));
}

export async function selectUnseenCursorRows<T extends ExtensionSpanInput & { dedupeKey: string }>(
  rows: T[],
): Promise<T[]> {
  const candidates = rows.filter((r) => r.hookEvent !== null && CURSOR_MCP_HOOK_EVENTS.has(r.hookEvent));
  if (candidates.length === 0) return [];
  const stored = await prisma.cursorSpan.findMany({
    where: { dedupeKey: { in: candidates.map((r) => r.dedupeKey) } },
    select: { dedupeKey: true },
  });
  const seen = new Set(stored.map((r) => r.dedupeKey));
  return candidates.filter((r) => !seen.has(r.dedupeKey));
}

/**
 * Ingest-side helper: extract + record, never throwing. The events are
 * already persisted by the time this runs, so an inventory failure must not
 * fail the telemetry request and trigger a collector retry. Pass only the
 * rows `selectUnseenClaudeCodeRows` returned, or a retry double-counts.
 */
export async function recordClaudeCodeExtensions(rows: ExtensionEventInput[]): Promise<RecordExtensionsResult | null> {
  try {
    const observations = extractClaudeCodeExtensions(rows);
    if (observations.length === 0) return null;
    return await recordExtensionObservations(observations);
  } catch (err) {
    console.error("[assistant-extensions] claude code inventory update failed", err);
    return null;
  }
}

export async function recordCursorExtensions(rows: ExtensionSpanInput[]): Promise<RecordExtensionsResult | null> {
  try {
    const observations = extractCursorExtensions(rows);
    if (observations.length === 0) return null;
    return await recordExtensionObservations(observations);
  } catch (err) {
    console.error("[assistant-extensions] cursor inventory update failed", err);
    return null;
  }
}

// ─── Backfill ────────────────────────────────────────────
// Walks the persisted ClaudeCodeEvent / CursorSpan history through the same
// extractors. Idempotent only in the sense that re-running over a window
// re-adds its observation counts; run it once per window, or truncate the
// table first.

export interface BackfillOptions {
  client?: ExtensionClient;
  since?: Date;
  until?: Date;
  /** Resume cursor from a previous call's `resume`. */
  resume?: { client: ExtensionClient; timestamp: Date; id: string } | null;
  pageSize?: number;
  /** Stop after this many ms and hand back a resume cursor. */
  timeBudgetMs?: number;
}

export interface BackfillResult {
  done: boolean;
  scanned: number;
  observations: number;
  rows: number;
  resume: { client: ExtensionClient; timestamp: Date; id: string } | null;
}

export async function backfillAssistantExtensions(opts: BackfillOptions = {}): Promise<BackfillResult> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 2000, 100), 5000);
  const deadline = Date.now() + (opts.timeBudgetMs ?? 240_000);
  const clients: ExtensionClient[] = opts.client ? [opts.client] : ["claude_code", "cursor"];
  let scanned = 0;
  let observations = 0;
  let rows = 0;

  // Resume skips the clients before the one the cursor names.
  const startAt = opts.resume ? clients.indexOf(opts.resume.client) : 0;
  for (let ci = Math.max(startAt, 0); ci < clients.length; ci++) {
    const client = clients[ci];
    let cursor: { timestamp: Date; id: string } | null =
      opts.resume && opts.resume.client === client ? { timestamp: opts.resume.timestamp, id: opts.resume.id } : null;

    for (;;) {
      if (Date.now() > deadline) {
        return {
          done: false,
          scanned,
          observations,
          rows,
          resume: cursor ? { client, ...cursor } : { client, timestamp: opts.since ?? new Date(0), id: "" },
        };
      }
      const timeFilter = {
        ...(opts.since ? { gte: opts.since } : {}),
        ...(opts.until ? { lte: opts.until } : {}),
      };
      // Keyset pagination on (timestamp, id).
      const after = cursor
        ? {
            OR: [
              { timestamp: { gt: cursor.timestamp } },
              { timestamp: cursor.timestamp, id: { gt: cursor.id } },
            ],
          }
        : {};

      let batch: ExtensionObservation[] = [];
      let last: { timestamp: Date; id: string } | null = null;
      if (client === "claude_code") {
        const events = await prisma.claudeCodeEvent.findMany({
          where: {
            eventName: { in: [...CLAUDE_CODE_EXTENSION_EVENTS] },
            ...(Object.keys(timeFilter).length ? { timestamp: timeFilter } : {}),
            ...after,
          },
          orderBy: [{ timestamp: "asc" }, { id: "asc" }],
          take: pageSize,
          select: {
            id: true,
            eventName: true,
            timestamp: true,
            sessionId: true,
            userId: true,
            userEmail: true,
            appVersion: true,
            attributes: true,
          },
        });
        scanned += events.length;
        batch = extractClaudeCodeExtensions(events);
        if (events.length) last = { timestamp: events[events.length - 1].timestamp, id: events[events.length - 1].id };
        if (events.length < pageSize) cursor = null;
      } else {
        const spans = await prisma.cursorSpan.findMany({
          where: {
            hookEvent: { in: [...CURSOR_MCP_HOOK_EVENTS] },
            ...(Object.keys(timeFilter).length ? { timestamp: timeFilter } : {}),
            ...after,
          },
          orderBy: [{ timestamp: "asc" }, { id: "asc" }],
          take: pageSize,
          select: {
            id: true,
            hookEvent: true,
            timestamp: true,
            sessionId: true,
            userId: true,
            userEmail: true,
            appVersion: true,
            genAiToolName: true,
            success: true,
            attributes: true,
          },
        });
        scanned += spans.length;
        batch = extractCursorExtensions(spans);
        if (spans.length) last = { timestamp: spans[spans.length - 1].timestamp, id: spans[spans.length - 1].id };
        if (spans.length < pageSize) cursor = null;
      }

      if (batch.length) {
        const result = await recordExtensionObservations(batch);
        observations += result.observations;
        rows += result.rows;
      }
      if (!last) break;
      if (cursor === null && last) {
        // Short page: this client is exhausted.
        break;
      }
      cursor = last;
    }
  }
  return { done: true, scanned, observations, rows, resume: null };
}

// ─── Read side ───────────────────────────────────────────

export interface ExtensionInventoryFilters {
  client?: ExtensionClient | null;
  kind?: ExtensionKind | null;
  /** Case-insensitive match against person, name, plugin, marketplace. */
  q?: string | null;
  redactedOnly?: boolean;
  limit?: number;
}

export interface ExtensionInventoryRow {
  id: string;
  client: ExtensionClient;
  userEmail: string;
  kind: ExtensionKind;
  name: string;
  redacted: boolean;
  source: string | null;
  marketplace: string | null;
  pluginName: string | null;
  version: string | null;
  transport: string | null;
  lastStatus: string | null;
  enabledVia: string | null;
  detail: Record<string, unknown>;
  observations: number;
  sessions: number;
  failures: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastAppVersion: string | null;
}

export interface ExtensionInventorySummary {
  rows: number;
  people: number;
  untagged: number;
  byKind: Record<ExtensionKind, number>;
  byClient: Record<ExtensionClient, number>;
  redacted: number;
  thirdPartyPlugins: number;
  failingServers: number;
  hooksFromProjects: number;
  lastSeenAt: Date | null;
}

export interface ExtensionInventory {
  summary: ExtensionInventorySummary;
  rows: ExtensionInventoryRow[];
}

/** Plugin provenance values that mean "not from Anthropic's own catalog". */
const THIRD_PARTY_PLUGIN_SCOPES = new Set(["community", "user-local"]);

export function isThirdPartyPlugin(row: { kind: string; redacted: boolean; source: string | null }): boolean {
  return row.kind === "plugin" && (row.redacted || (row.source !== null && THIRD_PARTY_PLUGIN_SCOPES.has(row.source)));
}

export async function loadAssistantExtensionInventory(
  filters: ExtensionInventoryFilters = {},
): Promise<ExtensionInventory> {
  const limit = Math.min(Math.max(filters.limit ?? 500, 1), 2000);
  const q = filters.q?.trim();
  const where: Prisma.AssistantExtensionWhereInput = {
    ...(filters.client ? { client: filters.client } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.redactedOnly ? { redacted: true } : {}),
    ...(q
      ? {
          OR: [
            { userEmail: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
            { pluginName: { contains: q, mode: "insensitive" } },
            { marketplace: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [rows, all] = await Promise.all([
    prisma.assistantExtension.findMany({
      where,
      orderBy: [{ lastSeenAt: "desc" }],
      take: limit,
    }),
    // Summary is fleet-wide, independent of the filters, so the cards keep
    // meaning while the table narrows.
    prisma.assistantExtension.findMany({
      select: {
        client: true,
        userEmail: true,
        kind: true,
        redacted: true,
        source: true,
        lastStatus: true,
        lastSeenAt: true,
      },
    }),
  ]);

  const byKind: Record<ExtensionKind, number> = { plugin: 0, mcp_server: 0, skill: 0, hook: 0, agent: 0 };
  const byClient: Record<ExtensionClient, number> = { claude_code: 0, cursor: 0 };
  const people = new Set<string>();
  let untagged = 0;
  let redacted = 0;
  let thirdPartyPlugins = 0;
  let failingServers = 0;
  let hooksFromProjects = 0;
  let lastSeenAt: Date | null = null;
  for (const r of all) {
    if (r.kind in byKind) byKind[r.kind as ExtensionKind] += 1;
    if (r.client in byClient) byClient[r.client as ExtensionClient] += 1;
    if (r.userEmail) people.add(r.userEmail);
    else untagged += 1;
    if (r.redacted) redacted += 1;
    if (isThirdPartyPlugin(r)) thirdPartyPlugins += 1;
    if (r.kind === "mcp_server" && r.lastStatus === "failed") failingServers += 1;
    if (r.kind === "hook" && (r.source === "projectSettings" || r.source === "localSettings")) hooksFromProjects += 1;
    if (!lastSeenAt || r.lastSeenAt > lastSeenAt) lastSeenAt = r.lastSeenAt;
  }

  return {
    summary: {
      rows: all.length,
      people: people.size,
      untagged,
      byKind,
      byClient,
      redacted,
      thirdPartyPlugins,
      failingServers,
      hooksFromProjects,
      lastSeenAt,
    },
    rows: rows.map((r) => ({
      id: r.id,
      client: r.client as ExtensionClient,
      userEmail: r.userEmail,
      kind: r.kind as ExtensionKind,
      name: r.name,
      redacted: r.redacted,
      source: r.source,
      marketplace: r.marketplace,
      pluginName: r.pluginName,
      version: r.version,
      transport: r.transport,
      lastStatus: r.lastStatus,
      enabledVia: r.enabledVia,
      detail: attrs(r.detail),
      observations: r.observations,
      sessions: r.sessions,
      failures: r.failures,
      firstSeenAt: r.firstSeenAt,
      lastSeenAt: r.lastSeenAt,
      lastAppVersion: r.lastAppVersion,
    })),
  };
}

/** Human label for a provenance value, shared by the page and the API. */
export function extensionSourceLabel(source: string | null): string {
  if (!source) return "—";
  const labels: Record<string, string> = {
    official: "Official marketplace",
    community: "Community marketplace",
    org: "Organization",
    "user-local": "Local (sideloaded)",
    "default-bundle": "Bundled",
    user: "User scope",
    project: "Project scope",
    local: "Local scope",
    bundled: "Bundled",
    userSettings: "User settings",
    projectSettings: "Project settings",
    localSettings: "Local settings",
    flagSettings: "CLI flag",
    policySettings: "Managed policy",
    pluginHook: "Plugin",
    plugin: "Plugin",
    "built-in": "Built in",
  };
  return labels[source] ?? source;
}

export function extensionEnabledViaLabel(v: string | null): string | null {
  if (!v) return null;
  const labels: Record<string, string> = {
    "default-enable": "Enabled by default",
    "org-policy": "Org policy",
    "admin-install": "Admin install",
    "seed-mount": "Seeded",
    "user-install": "User installed",
  };
  return labels[v] ?? v;
}
