// MIRROR of src/lib/mcp-tool-governance.ts — the ai-proxy is a separate project and
// cannot import from the Next.js app. Keep byte-identical below this header.
/**
 * MCP tool governance — pure logic shared (by copy) between the Next.js app
 * and the Azure Functions proxy. `ai-proxy/src/lib/mcp-tool-governance.ts` is
 * a byte-identical mirror; keep the two in sync.
 *
 * What this covers:
 * - Which MCP servers a request DECLARES (Anthropic `mcp_servers[]`, OpenAI
 *   Responses `tools[{type:"mcp"}]`).
 * - Which tools the model actually INVOKED in a response (`mcp_tool_use`,
 *   `server_tool_use`, client `tool_use` blocks; OpenAI `mcp_call` items and
 *   chat-completion `tool_calls`).
 * - Evaluating both against an agent's allowlists, and narrowing a request's
 *   `allowed_tools` so the provider itself enforces the tool allowlist.
 *
 * Allowlist grammar:
 * - Server entries match the server's declared `name` (case-insensitive) or
 *   its URL host. `*.example.com` matches any subdomain.
 * - Tool entries: `tool` (any server), `server/tool`, or `server/*`.
 * - An EMPTY allowlist means "not configured" and allows everything; the
 *   agent is then in observe-only mode for that dimension.
 */

export type DeclaredMcpServer = {
  name: string;
  url: string | null;
  host: string | null;
  /** Tool names the request itself restricts the server to, if any. */
  allowedTools: string[] | null;
};

export type ObservedToolKind = "mcp_tool_use" | "server_tool_use" | "tool_use";

export type ObservedToolUse = {
  kind: ObservedToolKind;
  toolName: string;
  /** MCP server name for mcp_tool_use; null for provider/client tools. */
  serverName: string | null;
  /**
   * The call's arguments (`tool_use.input`, OpenAI `function.arguments` /
   * `mcp_call.arguments`, parsed when they are JSON). Present only when the
   * response carried them; human-review triggers evaluate against this.
   */
  input?: unknown;
  /** Provider call id (`tool_use.id`, `call_id`), when present. */
  id?: string;
};

/** OpenAI ships arguments as a JSON string; Anthropic as an object. */
function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function withArgs(use: ObservedToolUse, input: unknown, id: unknown): ObservedToolUse {
  const out: ObservedToolUse = { ...use };
  if (input !== undefined) out.input = input;
  const callId = str(id);
  if (callId) out.id = callId;
  return out;
}

export type McpEnforcementMode = "monitor" | "enforce";

export type McpGovernanceConfig = {
  serverAllowlist: string[];
  toolAllowlist: string[];
  enforcement: McpEnforcementMode;
};

export type ServerVerdict = { server: DeclaredMcpServer; allowed: boolean };
export type ToolVerdict = { use: ObservedToolUse; allowed: boolean };

export const EMPTY_MCP_CONFIG: McpGovernanceConfig = {
  serverAllowlist: [],
  toolAllowlist: [],
  enforcement: "monitor",
};

export function normalizeEnforcement(value: unknown): McpEnforcementMode {
  return value === "enforce" ? "enforce" : "monitor";
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  try {
    return new URL(url).host.toLowerCase() || null;
  } catch {
    return null;
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function strList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return out.length ? out : [];
}

// ─── Request side: declared servers ────────────────────────────────────────

export function extractDeclaredMcpServers(bodyJson: unknown): DeclaredMcpServer[] {
  if (!bodyJson || typeof bodyJson !== "object") return [];
  const body = bodyJson as Record<string, unknown>;
  const out: DeclaredMcpServer[] = [];

  // Anthropic Messages API: mcp_servers: [{ type: "url", url, name, tool_configuration? }]
  if (Array.isArray(body.mcp_servers)) {
    for (const raw of body.mcp_servers) {
      if (!raw || typeof raw !== "object") continue;
      const s = raw as Record<string, unknown>;
      const url = str(s.url);
      const name = str(s.name) ?? hostOf(url) ?? "unnamed";
      const toolConfig =
        s.tool_configuration && typeof s.tool_configuration === "object"
          ? (s.tool_configuration as Record<string, unknown>)
          : null;
      out.push({
        name,
        url,
        host: hostOf(url),
        allowedTools: toolConfig ? strList(toolConfig.allowed_tools) : null,
      });
    }
  }

  // OpenAI Responses API: tools: [{ type: "mcp", server_label, server_url, allowed_tools? }]
  if (Array.isArray(body.tools)) {
    for (const raw of body.tools) {
      if (!raw || typeof raw !== "object") continue;
      const t = raw as Record<string, unknown>;
      if (t.type !== "mcp") continue;
      const url = str(t.server_url);
      const name = str(t.server_label) ?? hostOf(url) ?? "unnamed";
      const allowed = Array.isArray(t.allowed_tools)
        ? strList(t.allowed_tools)
        : t.allowed_tools && typeof t.allowed_tools === "object"
          ? strList((t.allowed_tools as Record<string, unknown>).tool_names)
          : null;
      out.push({ name, url, host: hostOf(url), allowedTools: allowed });
    }
  }

  return out;
}

// ─── Response side: observed tool uses ─────────────────────────────────────

function blockToToolUse(block: unknown): ObservedToolUse | null {
  if (!block || typeof block !== "object") return null;
  const b = block as Record<string, unknown>;
  const name = str(b.name);
  if (!name) return null;
  switch (b.type) {
    case "mcp_tool_use":
      return withArgs({ kind: "mcp_tool_use", toolName: name, serverName: str(b.server_name) }, b.input, b.id);
    case "server_tool_use":
      return withArgs({ kind: "server_tool_use", toolName: name, serverName: null }, b.input, b.id);
    case "tool_use":
      return withArgs({ kind: "tool_use", toolName: name, serverName: null }, b.input, b.id);
    default:
      return null;
  }
}

/** Non-streaming Anthropic response: `content[]` blocks. */
export function extractAnthropicToolUses(content: unknown): ObservedToolUse[] {
  if (!Array.isArray(content)) return [];
  const out: ObservedToolUse[] = [];
  for (const block of content) {
    const use = blockToToolUse(block);
    if (use) out.push(use);
  }
  return out;
}

/** Streaming Anthropic SSE event: `content_block_start` carries the block header. */
export function extractAnthropicStreamToolUse(event: unknown): ObservedToolUse | null {
  if (!event || typeof event !== "object") return null;
  const e = event as Record<string, unknown>;
  if (e.type !== "content_block_start") return null;
  return blockToToolUse(e.content_block);
}

/**
 * Non-streaming OpenAI response. Handles the Responses API (`output[]` items)
 * and Chat Completions (`choices[].message.tool_calls[]`).
 */
export function extractOpenAIToolUses(responseBody: unknown): ObservedToolUse[] {
  if (!responseBody || typeof responseBody !== "object") return [];
  const body = responseBody as Record<string, unknown>;
  const out: ObservedToolUse[] = [];

  if (Array.isArray(body.output)) {
    for (const raw of body.output) {
      const use = openAIOutputItemToToolUse(raw);
      if (use) out.push(use);
    }
  }

  if (Array.isArray(body.choices)) {
    for (const choice of body.choices) {
      const message = (choice as Record<string, unknown> | null)?.message as
        | Record<string, unknown>
        | undefined;
      const calls = message?.tool_calls;
      if (!Array.isArray(calls)) continue;
      for (const call of calls) {
        const fn = (call as Record<string, unknown> | null)?.function as
          | Record<string, unknown>
          | undefined;
        const name = str(fn?.name);
        if (name) {
          out.push(
            withArgs(
              { kind: "tool_use", toolName: name, serverName: null },
              parseArguments(fn?.arguments),
              (call as Record<string, unknown>).id
            )
          );
        }
      }
    }
  }

  return out;
}

function openAIOutputItemToToolUse(raw: unknown): ObservedToolUse | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  switch (item.type) {
    case "mcp_call": {
      const name = str(item.name);
      return name
        ? withArgs(
            { kind: "mcp_tool_use", toolName: name, serverName: str(item.server_label) },
            parseArguments(item.arguments),
            item.id
          )
        : null;
    }
    case "function_call": {
      const name = str(item.name);
      return name
        ? withArgs(
            { kind: "tool_use", toolName: name, serverName: null },
            parseArguments(item.arguments),
            item.call_id ?? item.id
          )
        : null;
    }
    case "web_search_call":
    case "file_search_call":
    case "code_interpreter_call":
    case "computer_call":
    case "image_generation_call":
      return { kind: "server_tool_use", toolName: String(item.type).replace(/_call$/, ""), serverName: null };
    default:
      return null;
  }
}

/**
 * Streaming OpenAI SSE event. Responses API emits `response.output_item.done`
 * (and `.added`) with the full item; Chat Completions streams
 * `choices[0].delta.tool_calls[]` where the function name is present on the
 * first chunk only.
 */
export function extractOpenAIStreamToolUses(event: unknown): ObservedToolUse[] {
  if (!event || typeof event !== "object") return [];
  const e = event as Record<string, unknown>;
  const out: ObservedToolUse[] = [];

  if (e.type === "response.output_item.done" && e.item) {
    const use = openAIOutputItemToToolUse(e.item);
    if (use) out.push(use);
    return out;
  }

  if (Array.isArray(e.choices)) {
    for (const choice of e.choices) {
      const delta = (choice as Record<string, unknown> | null)?.delta as
        | Record<string, unknown>
        | undefined;
      const calls = delta?.tool_calls;
      if (!Array.isArray(calls)) continue;
      for (const call of calls) {
        const fn = (call as Record<string, unknown> | null)?.function as
          | Record<string, unknown>
          | undefined;
        const name = str(fn?.name);
        if (name) out.push({ kind: "tool_use", toolName: name, serverName: null });
      }
    }
  }
  return out;
}

// ─── Streaming accumulators ────────────────────────────────────────────────
//
// The `extract*Stream*` helpers above see a tool call the moment its header
// arrives, which is all allowlisting needs. Human-review triggers need the
// ARGUMENTS, which stream in afterwards: Anthropic sends `input_json_delta`
// fragments until `content_block_stop`; Chat Completions sends
// `delta.tool_calls[].function.arguments` fragments per call index; the
// Responses API sends the whole item on `response.output_item.done`. These
// accumulators emit a use only once its arguments are complete.

export type AnthropicToolUseAccumulator = {
  /** Feed one SSE event; returns the completed use when a tool block closes. */
  push(event: unknown): ObservedToolUse | null;
  /** Uses whose block never closed (stream cut short). */
  flush(): ObservedToolUse[];
};

export function createAnthropicToolUseAccumulator(): AnthropicToolUseAccumulator {
  const open = new Map<number, { use: ObservedToolUse; json: string }>();
  const indexOf = (e: Record<string, unknown>) => (typeof e.index === "number" ? e.index : -1);
  const finalize = (entry: { use: ObservedToolUse; json: string }): ObservedToolUse => {
    if (!entry.json) return entry.use;
    return withArgs(entry.use, parseArguments(entry.json), entry.use.id);
  };
  return {
    push(event) {
      if (!event || typeof event !== "object") return null;
      const e = event as Record<string, unknown>;
      if (e.type === "content_block_start") {
        const use = blockToToolUse(e.content_block);
        if (use) open.set(indexOf(e), { use, json: "" });
        return null;
      }
      if (e.type === "content_block_delta") {
        const delta = e.delta as Record<string, unknown> | undefined;
        if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
          const entry = open.get(indexOf(e));
          if (entry) entry.json += delta.partial_json;
        }
        return null;
      }
      if (e.type === "content_block_stop") {
        const entry = open.get(indexOf(e));
        if (!entry) return null;
        open.delete(indexOf(e));
        return finalize(entry);
      }
      return null;
    },
    flush() {
      const out = Array.from(open.values()).map(finalize);
      open.clear();
      return out;
    },
  };
}

export type OpenAIToolUseAccumulator = {
  /** Feed one SSE event; returns the uses completed by it. */
  push(event: unknown): ObservedToolUse[];
  /** Chat Completions calls still open when the stream ends. */
  flush(): ObservedToolUse[];
};

export function createOpenAIToolUseAccumulator(
  endpoint: "responses" | "chat_completions" | string = "chat_completions"
): OpenAIToolUseAccumulator {
  // Chat Completions: one partial call per (choice, index).
  const open = new Map<string, { name: string | null; id: string | null; args: string }>();
  const finalizeAll = (): ObservedToolUse[] => {
    const out: ObservedToolUse[] = [];
    for (const partial of open.values()) {
      if (!partial.name) continue;
      out.push(
        withArgs({ kind: "tool_use", toolName: partial.name, serverName: null }, parseArguments(partial.args), partial.id)
      );
    }
    open.clear();
    return out;
  };
  return {
    push(event) {
      if (!event || typeof event !== "object") return [];
      const e = event as Record<string, unknown>;
      if (endpoint === "responses" || e.type === "response.output_item.done") {
        if (e.type === "response.output_item.done" && e.item) {
          const use = openAIOutputItemToToolUse(e.item);
          return use ? [use] : [];
        }
        return [];
      }
      if (!Array.isArray(e.choices)) return [];
      const out: ObservedToolUse[] = [];
      e.choices.forEach((rawChoice, choiceIndex) => {
        const choice = rawChoice as Record<string, unknown> | null;
        const delta = choice?.delta as Record<string, unknown> | undefined;
        const calls = delta?.tool_calls;
        if (Array.isArray(calls)) {
          for (const rawCall of calls) {
            const call = rawCall as Record<string, unknown> | null;
            if (!call) continue;
            const fn = call.function as Record<string, unknown> | undefined;
            const key = `${choiceIndex}:${typeof call.index === "number" ? call.index : 0}`;
            const partial = open.get(key) ?? { name: null, id: null, args: "" };
            if (str(fn?.name)) partial.name = str(fn?.name);
            if (str(call.id)) partial.id = str(call.id);
            if (typeof fn?.arguments === "string") partial.args += fn.arguments;
            open.set(key, partial);
          }
        }
        if (choice?.finish_reason) out.push(...finalizeAll());
      });
      return out;
    },
    flush: finalizeAll,
  };
}

/** `data:` payloads of an SSE body, in order; `[DONE]` and blanks skipped. */
export function sseDataPayloads(text: string): string[] {
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    out.push(data);
  }
  return out;
}

/** Every tool use (with arguments) in a fully buffered Anthropic SSE body. */
export function collectAnthropicToolUsesFromSse(text: string): ObservedToolUse[] {
  const acc = createAnthropicToolUseAccumulator();
  const out: ObservedToolUse[] = [];
  for (const data of sseDataPayloads(text)) {
    try {
      const use = acc.push(JSON.parse(data));
      if (use) out.push(use);
    } catch {
      // skip non-JSON payloads
    }
  }
  return [...out, ...acc.flush()];
}

/** Every tool use (with arguments) in a fully buffered OpenAI SSE body. */
export function collectOpenAIToolUsesFromSse(
  text: string,
  endpoint: "responses" | "chat_completions" | string = "chat_completions"
): ObservedToolUse[] {
  const acc = createOpenAIToolUseAccumulator(endpoint);
  const out: ObservedToolUse[] = [];
  for (const data of sseDataPayloads(text)) {
    try {
      out.push(...acc.push(JSON.parse(data)));
    } catch {
      // skip
    }
  }
  return [...out, ...acc.flush()];
}

// ─── Allowlist evaluation ──────────────────────────────────────────────────

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .toLowerCase()
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

export function isServerAllowed(
  server: { name: string; host: string | null },
  serverAllowlist: string[]
): boolean {
  if (serverAllowlist.length === 0) return true;
  const name = server.name.toLowerCase();
  const host = server.host?.toLowerCase() ?? null;
  return serverAllowlist.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (!entry) return false;
    if (entry === name || (host && entry === host)) return true;
    if (entry.includes("*")) {
      const re = globToRegex(entry);
      return re.test(name) || (host !== null && re.test(host));
    }
    // Allow full URLs in the allowlist too.
    const entryHost = hostOf(entry);
    return entryHost !== null && host !== null && entryHost === host;
  });
}

/**
 * Only MCP tool invocations are governed by the tool allowlist. Provider
 * built-in tools (web search, code execution) and the agent's own client
 * tools are recorded for visibility but never denied here.
 */
export function isToolAllowed(use: ObservedToolUse, config: McpGovernanceConfig): boolean {
  if (use.kind !== "mcp_tool_use") return true;
  const serverName = use.serverName?.toLowerCase() ?? null;

  // A tool from a server that is not on a configured server allowlist is
  // unapproved regardless of the tool allowlist.
  if (
    config.serverAllowlist.length > 0 &&
    serverName !== null &&
    !isServerAllowed({ name: serverName, host: null }, config.serverAllowlist)
  ) {
    return false;
  }

  if (config.toolAllowlist.length === 0) return true;
  const tool = use.toolName.toLowerCase();
  return config.toolAllowlist.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (!entry) return false;
    const slash = entry.indexOf("/");
    if (slash === -1) return entry === tool || (entry.includes("*") && globToRegex(entry).test(tool));
    const entryServer = entry.slice(0, slash);
    const entryTool = entry.slice(slash + 1);
    const serverMatches =
      serverName !== null && (entryServer === serverName || (entryServer.includes("*") && globToRegex(entryServer).test(serverName)));
    if (!serverMatches) return false;
    return entryTool === "*" || entryTool === tool || (entryTool.includes("*") && globToRegex(entryTool).test(tool));
  });
}

// ─── Org catalog ───────────────────────────────────────────────────────────

export type McpCatalogEntryLike = {
  /** Server name, host, URL or wildcard pattern (allowlist grammar). */
  server: string;
  /** Tool names allowed on that server; empty = every tool. */
  tools: string[];
};

/**
 * Merge the org-wide approved catalog into an agent's own allowlists.
 *
 * Servers are additive: every catalog server is allowed for the agent. When
 * the agent has no server allowlist of its own, the catalog BECOMES its
 * allowlist (that is the point of inheriting: unlisted servers are then
 * unapproved).
 *
 * Tool restrictions from the catalog apply only when the agent already keeps
 * a tool allowlist, where `server/tool` entries are purely additive. An agent
 * with no tool allowlist keeps "any tool on an allowed server": turning the
 * catalog's tool lists into a restriction there would also have to spell out
 * `server/*` for the agent's own servers, which cannot be done for host or
 * URL patterns, so such agents would start denying tools on their own
 * servers. Predictable beats clever here.
 */
export function mergeCatalogIntoConfig(
  own: McpGovernanceConfig,
  catalog: McpCatalogEntryLike[]
): McpGovernanceConfig {
  const entries = catalog.filter((e) => e.server.trim());
  if (entries.length === 0) return own;
  const servers = new Set(own.serverAllowlist.map((s) => s.trim()).filter(Boolean));
  for (const e of entries) servers.add(e.server.trim());

  const tools = new Set(own.toolAllowlist.map((t) => t.trim()).filter(Boolean));
  if (tools.size > 0) {
    for (const e of entries) {
      const server = e.server.trim();
      if (e.tools.length === 0) tools.add(`${server}/*`);
      else for (const t of e.tools) if (t.trim()) tools.add(`${server}/${t.trim()}`);
    }
  }
  return { serverAllowlist: [...servers], toolAllowlist: [...tools], enforcement: own.enforcement };
}

export function evaluateServers(servers: DeclaredMcpServer[], config: McpGovernanceConfig): ServerVerdict[] {
  return servers.map((server) => ({ server, allowed: isServerAllowed(server, config.serverAllowlist) }));
}

export function evaluateToolUses(uses: ObservedToolUse[], config: McpGovernanceConfig): ToolVerdict[] {
  return uses.map((use) => ({ use, allowed: isToolAllowed(use, config) }));
}

/** Collapse repeated invocations of the same tool within one response. */
export function dedupeToolUses(uses: ObservedToolUse[]): ObservedToolUse[] {
  const seen = new Set<string>();
  const out: ObservedToolUse[] = [];
  for (const use of uses) {
    const key = `${use.kind}|${use.serverName ?? ""}|${use.toolName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(use);
  }
  return out;
}

/**
 * Tool names the allowlist permits for a given server, or null when the
 * allowlist does not restrict that server to specific tools (no entries, a
 * `server/*` entry, or wildcard tool patterns we cannot expand).
 */
export function allowedToolNamesForServer(serverName: string, config: McpGovernanceConfig): string[] | null {
  if (config.toolAllowlist.length === 0) return null;
  const server = serverName.toLowerCase();
  const names = new Set<string>();
  for (const raw of config.toolAllowlist) {
    const entry = raw.trim();
    if (!entry) continue;
    const slash = entry.indexOf("/");
    if (slash === -1) {
      if (entry.includes("*")) return null;
      names.add(entry);
      continue;
    }
    const entryServer = entry.slice(0, slash).toLowerCase();
    const entryTool = entry.slice(slash + 1);
    const serverMatches = entryServer === server || (entryServer.includes("*") && globToRegex(entryServer).test(server));
    if (!serverMatches) continue;
    if (entryTool === "*" || entryTool.includes("*")) return null;
    names.add(entryTool);
  }
  return names.size > 0 ? Array.from(names) : [];
}

/**
 * Narrow the request so the provider only exposes allowlisted tools to the
 * model. Returns the (possibly) rewritten body and whether anything changed.
 * Works on Anthropic `mcp_servers[].tool_configuration.allowed_tools` and
 * OpenAI Responses `tools[type=mcp].allowed_tools`. Existing request-side
 * restrictions are intersected, never widened.
 */
export function restrictAllowedTools(
  bodyJson: Record<string, unknown> | null,
  config: McpGovernanceConfig
): { body: Record<string, unknown> | null; changed: boolean } {
  if (!bodyJson || config.toolAllowlist.length === 0) return { body: bodyJson, changed: false };
  let changed = false;
  const body: Record<string, unknown> = { ...bodyJson };

  const intersect = (requested: string[] | null, allowed: string[]): string[] =>
    requested ? requested.filter((t) => allowed.includes(t)) : allowed;

  if (Array.isArray(body.mcp_servers)) {
    body.mcp_servers = (body.mcp_servers as unknown[]).map((raw) => {
      if (!raw || typeof raw !== "object") return raw;
      const s = { ...(raw as Record<string, unknown>) };
      const name = str(s.name) ?? hostOf(str(s.url)) ?? "unnamed";
      const allowed = allowedToolNamesForServer(name, config);
      if (allowed === null) return raw;
      const toolConfig =
        s.tool_configuration && typeof s.tool_configuration === "object"
          ? { ...(s.tool_configuration as Record<string, unknown>) }
          : {};
      const requested = strList(toolConfig.allowed_tools);
      const next = intersect(requested, allowed);
      if (requested && requested.length === next.length && requested.every((t, i) => t === next[i])) return raw;
      toolConfig.allowed_tools = next;
      s.tool_configuration = toolConfig;
      changed = true;
      return s;
    });
  }

  if (Array.isArray(body.tools)) {
    body.tools = (body.tools as unknown[]).map((raw) => {
      if (!raw || typeof raw !== "object") return raw;
      const t = raw as Record<string, unknown>;
      if (t.type !== "mcp") return raw;
      const name = str(t.server_label) ?? hostOf(str(t.server_url)) ?? "unnamed";
      const allowed = allowedToolNamesForServer(name, config);
      if (allowed === null) return raw;
      const requested = Array.isArray(t.allowed_tools) ? strList(t.allowed_tools) : null;
      const next = intersect(requested, allowed);
      if (requested && requested.length === next.length && requested.every((x, i) => x === next[i])) return raw;
      changed = true;
      return { ...t, allowed_tools: next };
    });
  }

  return { body: changed ? body : bodyJson, changed };
}

// ─── Misc helpers ──────────────────────────────────────────────────────────

export function scopeKeyFor(agentId: string | null, aiSystemId: string | null): string {
  if (agentId) return `agent:${agentId}`;
  if (aiSystemId) return `system:${aiSystemId}`;
  return "global";
}

export function toolLabel(use: { serverName: string | null; toolName: string }): string {
  return use.serverName ? `${use.serverName}/${use.toolName}` : use.toolName;
}

export function summarizeMcpForMetadata(
  servers: DeclaredMcpServer[],
  uses: ObservedToolUse[]
): { declaredServers: string[]; toolCalls: number; tools: string[] } | undefined {
  if (servers.length === 0 && uses.length === 0) return undefined;
  const deduped = dedupeToolUses(uses);
  return {
    declaredServers: servers.map((s) => s.name),
    toolCalls: uses.length,
    tools: deduped.map(toolLabel).slice(0, 50),
  };
}
