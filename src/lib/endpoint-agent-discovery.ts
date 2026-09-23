/**
 * Endpoint agent → Agent discovery (Gap 3 of docs/plans/agent-discovery.md).
 *
 * Pure builders that turn the `agents` collector's MCP servers and agent
 * frameworks into `DiscoveredAgent` inputs. No database access here, so the
 * scoring and row-shaping rules are unit-testable; `ingestEndpointReport`
 * does the writes through `upsertDiscoveredAgent()`.
 *
 * Row granularity: **one row per (device, MCP client)**, not per server. The
 * thing a reviewer registers or blocks is "Claude Desktop on alice-mbp with
 * these seven servers": registering it creates one AIAgent whose MCP
 * allowlist is seeded with those servers, which is exactly the Agent
 * Registry's shape. One row per server would put ~10 rows and 10 alerts per
 * developer per client in the queue, none of which can be registered as an
 * agent on its own. Individual servers stay visible in `mcpServers`, in
 * `metadata.servers`, and as `mcp` detections on the device page.
 *
 * Agent frameworks get **one row per device**, low confidence and no alert:
 * an installed SDK means someone on that machine builds agents, not that an
 * agent is running. It is a lead for a reviewer, kept separate from the MCP
 * client rows because it is not attached to any client.
 */
import { createHash } from "node:crypto";
import {
  confidenceForScore,
  type AgentConfidence,
  type AgentSignal,
  type DiscoveredAgentInput,
} from "./agent-discovery";
import {
  SENSITIVE_MCP_CAPABILITIES,
  isMcpBridgePackage,
  matchMcpServer,
} from "./mcp-server-registry";
import {
  MCP_CLIENTS,
  type EndpointAgentFramework,
  type EndpointMcpServer,
  type McpClient,
} from "./validations/endpoint-agent";

export const MCP_CLIENT_LABELS: Record<McpClient, string> = {
  claude_desktop: "Claude Desktop",
  claude_code: "Claude Code",
  cursor: "Cursor",
  windsurf: "Windsurf",
  vscode: "VS Code",
  cline: "Cline",
  roo_code: "Roo Code",
  zed: "Zed",
  continue: "Continue",
  gemini_cli: "Gemini CLI",
  codex: "Codex CLI",
};

export function mcpClientLabel(client: string): string {
  return MCP_CLIENT_LABELS[client as McpClient] ?? client;
}

/** In priority order: the first one found becomes the row's `framework`. */
export const AGENT_FRAMEWORK_LABELS: Record<string, string> = {
  claude_agent_sdk: "Claude Agent SDK",
  openai_agents: "OpenAI Agents SDK",
  langgraph: "LangGraph",
  crewai: "CrewAI",
  autogen: "AutoGen / AG2",
  google_adk: "Google ADK",
  pydantic_ai: "Pydantic AI",
  mastra: "Mastra",
  strands: "Strands Agents",
  smolagents: "smolagents",
  agno: "Agno",
  semantic_kernel: "Semantic Kernel",
  llama_index: "LlamaIndex",
  haystack: "Haystack",
  langchain: "LangChain",
};

export function frameworkLabel(id: string): string {
  return AGENT_FRAMEWORK_LABELS[id] ?? id;
}

/** How a single configured server looks to a reviewer. */
export type McpServerRisk =
  | "known"
  | "unknown_remote"
  | "unknown_package"
  | "unidentified_local"
  | "bridge";

export interface McpServerSummary {
  name: string;
  transport: string;
  host: string | null;
  loopback: boolean;
  launcher: string | null;
  package: string | null;
  known: string | null;
  knownLabel: string | null;
  vendor: string | null;
  sensitive: boolean;
  risk: McpServerRisk;
}

export function summarizeMcpServer(server: EndpointMcpServer): McpServerSummary {
  const host = server.host ?? null;
  const pkg = server.package ?? null;
  const known = matchMcpServer({ package: pkg, host });
  let risk: McpServerRisk;
  if (known) risk = "known";
  else if (isMcpBridgePackage(pkg)) risk = "bridge";
  else if (server.transport !== "stdio" && !server.loopback) risk = "unknown_remote";
  else if (pkg) risk = "unknown_package";
  else risk = "unidentified_local";
  return {
    name: server.name,
    transport: server.transport,
    host,
    loopback: server.loopback,
    launcher: server.launcher ?? null,
    package: pkg,
    known: known?.id ?? null,
    knownLabel: known?.label ?? null,
    vendor: known?.vendor ?? null,
    sensitive: Boolean(known?.capabilities.some((c) => SENSITIVE_MCP_CAPABILITIES.has(c))),
    risk,
  };
}

/** Stable identity of one server within a client config. */
export function mcpServerKey(s: {
  name: string;
  transport: string;
  host?: string | null;
  launcher?: string | null;
  package?: string | null;
}): string {
  return [s.name, s.transport, s.host ?? "", s.launcher ?? "", s.package ?? ""].join("|");
}

/** The most identifying bit of a server, for detection evidence and display. */
export function mcpServerIdentity(s: {
  transport: string;
  host?: string | null;
  loopback?: boolean;
  launcher?: string | null;
  package?: string | null;
}): string {
  if (s.host) return s.host;
  if (s.package) return s.package;
  if (s.loopback) return "localhost";
  return s.launcher ?? s.transport;
}

/** Group by client in a fixed order, servers sorted by name within each. */
export function groupMcpServersByClient(
  servers: EndpointMcpServer[],
): Array<{ client: McpClient; servers: EndpointMcpServer[] }> {
  const byClient = new Map<McpClient, Map<string, EndpointMcpServer>>();
  for (const server of servers) {
    const list = byClient.get(server.client) ?? new Map<string, EndpointMcpServer>();
    list.set(mcpServerKey(server), server);
    byClient.set(server.client, list);
  }
  return MCP_CLIENTS.filter((client) => byClient.has(client)).map((client) => ({
    client,
    servers: [...byClient.get(client)!.values()].sort((a, b) =>
      mcpServerKey(a).localeCompare(mcpServerKey(b)),
    ),
  }));
}

/** Servers that should make a reviewer look twice. */
export function isRiskyServer(summary: McpServerSummary): boolean {
  return (
    summary.risk === "unknown_remote" ||
    summary.risk === "unknown_package" ||
    summary.risk === "bridge"
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function listNames(values: string[], max = 4): string {
  const shown = values.slice(0, max).join(", ");
  return values.length > max ? `${shown} +${values.length - max} more` : shown;
}

/**
 * Score one client configuration. Recognized, non-sensitive servers only →
 * low; an unrecognized remote host or package, or a bridge hiding a remote
 * host → medium or high. Weights sum and cap at 100.
 */
export function scoreMcpClientConfig(
  clientLabel: string,
  summaries: McpServerSummary[],
): { score: number; confidence: AgentConfidence; signals: AgentSignal[] } {
  const signals: AgentSignal[] = [
    {
      key: "mcp_configured",
      label: `${plural(summaries.length, "MCP server")} configured in ${clientLabel}`,
      weight: 30,
    },
  ];
  const by = (risk: McpServerRisk) => summaries.filter((s) => s.risk === risk);

  const unknownRemote = by("unknown_remote");
  if (unknownRemote.length) {
    const hosts = unknownRemote.map((s) => s.host ?? "unresolved host");
    signals.push({
      key: "unknown_remote_host",
      label: `Unrecognized remote MCP host: ${listNames([...new Set(hosts)])}`,
      weight: 30,
    });
  }
  const unknownPackage = by("unknown_package");
  if (unknownPackage.length) {
    signals.push({
      key: "unknown_package",
      label: `Unrecognized MCP package: ${listNames(unknownPackage.map((s) => s.package!))}`,
      weight: 20,
    });
  }
  const bridges = by("bridge");
  if (bridges.length) {
    signals.push({
      key: "remote_bridge",
      label: `Local bridge to an unseen remote server: ${listNames(bridges.map((s) => s.name))}`,
      weight: 15,
    });
  }
  const sensitive = summaries.filter((s) => s.sensitive);
  if (sensitive.length) {
    signals.push({
      key: "sensitive_capability",
      label: `File system, shell, database, browser, payments or cloud access: ${listNames(
        sensitive.map((s) => s.knownLabel ?? s.name),
      )}`,
      weight: 15,
    });
  }
  const unidentified = by("unidentified_local");
  if (unidentified.length) {
    signals.push({
      key: "unidentified_local",
      label: `Local script or binary with no package id: ${listNames(unidentified.map((s) => s.name))}`,
      weight: 10,
    });
  }
  if (summaries.length >= 10) {
    signals.push({ key: "many_servers", label: "10 or more MCP servers", weight: 5 });
  }

  const score = Math.min(
    100,
    signals.reduce((sum, s) => sum + s.weight, 0),
  );
  return { score, confidence: confidenceForScore(score), signals };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** machineId, not the device row id: it survives re-enrollment. */
export function mcpClientExternalId(machineId: string, client: string): string {
  return sha256(`endpoint_agent|${machineId}|mcp_client|${client}`);
}

export function frameworksExternalId(machineId: string): string {
  return sha256(`endpoint_agent|${machineId}|frameworks`);
}

/** Alert on creation only when the config is worth a look. */
export const MCP_ALERT_MIN_SCORE = 50;

export interface EndpointDiscoveryDevice {
  id: string;
  machineId: string;
  hostname: string;
  userEmail: string | null;
}

export interface McpClientDiscovery {
  input: DiscoveredAgentInput;
  summaries: McpServerSummary[];
  score: number;
}

/** Build the one DiscoveredAgent row for a (device, client) configuration. */
export function buildMcpClientDiscovery(params: {
  device: EndpointDiscoveryDevice;
  client: McpClient;
  servers: EndpointMcpServer[];
  observedAt: Date;
}): McpClientDiscovery {
  const { device, client, servers, observedAt } = params;
  const label = mcpClientLabel(client);
  const summaries = servers.map(summarizeMcpServer);
  const { score, confidence, signals } = scoreMcpClientConfig(label, summaries);

  const names = summaries.map((s) => s.name);
  return {
    summaries,
    score,
    input: {
      source: "endpoint_agent",
      externalId: mcpClientExternalId(device.machineId, client),
      name: `${label} MCP config on ${device.hostname}`,
      description: `${plural(summaries.length, "MCP server")} configured in ${label} on ${device.hostname}: ${listNames(names, 12)}.`,
      platform: label,
      confidence,
      score,
      signals,
      mcpServers: names,
      userEmails: device.userEmail ? [device.userEmail] : [],
      ownerEmail: device.userEmail,
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
      // Fleet rollout would otherwise raise one alert per laptop. A config
      // with any risky server always alerts, matching the drift alert, so a
      // new bridge alerts the same whether the row is new or existing.
      suppressAlert: score < MCP_ALERT_MIN_SCORE && !summaries.some(isRiskyServer),
      metadata: {
        kind: "mcp_client",
        deviceId: device.id,
        hostname: device.hostname,
        client,
        clientLabel: label,
        serverCount: summaries.length,
        observedAt: observedAt.toISOString(),
        // Risky servers this row has already alerted on (at creation). Ingest
        // replaces this with the cumulative set; see alertedServerKeys().
        alertedServerKeys: summaries.filter(isRiskyServer).map(mcpServerKey),
        servers: summaries.map((s) => ({
          name: s.name,
          transport: s.transport,
          host: s.host,
          loopback: s.loopback,
          launcher: s.launcher,
          package: s.package,
          known: s.known,
          risk: s.risk,
        })),
      },
    },
  };
}

/**
 * The risky servers in `current` that the stored row did not already list —
 * a new unknown remote host or package added to a config that was already in
 * the queue (or already approved). Those alert even though the row exists.
 */
export function newRiskyServers(
  previousMetadata: unknown,
  current: McpServerSummary[],
): McpServerSummary[] {
  // Previously listed servers and every server ever alerted on: a risky
  // server toggled off and on again (or cleared and re-added) alerts once.
  const previous = new Set<string>(storedAlertedKeys(previousMetadata));
  const stored =
    previousMetadata && typeof previousMetadata === "object" && !Array.isArray(previousMetadata)
      ? (previousMetadata as { servers?: unknown }).servers
      : undefined;
  if (Array.isArray(stored)) {
    for (const s of stored) {
      if (s && typeof s === "object" && typeof (s as { name?: unknown }).name === "string") {
        previous.add(mcpServerKey(s as Parameters<typeof mcpServerKey>[0]));
      }
    }
  }
  return current.filter((s) => isRiskyServer(s) && !previous.has(mcpServerKey(s)));
}

function storedAlertedKeys(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const keys = (metadata as { alertedServerKeys?: unknown }).alertedServerKeys;
  return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string") : [];
}

/** Cap on the cumulative alerted-key set, so a churning config cannot grow a row unbounded. */
const MAX_ALERTED_KEYS = 500;

/**
 * The cumulative set of risky server keys a row has alerted on: the stored
 * set plus every risky server in the current config. Never shrinks.
 */
export function alertedServerKeys(previousMetadata: unknown, current: McpServerSummary[]): string[] {
  const keys = new Set(storedAlertedKeys(previousMetadata));
  for (const s of current) if (isRiskyServer(s)) keys.add(mcpServerKey(s));
  return [...keys].slice(-MAX_ALERTED_KEYS);
}

/**
 * Whether a report's view of a config is at least as new as the stored one.
 * A spooled report replayed late must not roll `metadata.servers` back.
 */
export function isNewerObservation(previousMetadata: unknown, observedAt: Date): boolean {
  if (!previousMetadata || typeof previousMetadata !== "object") return true;
  const raw = (previousMetadata as { observedAt?: unknown }).observedAt;
  if (typeof raw !== "string") return true;
  const previous = new Date(raw);
  return Number.isNaN(previous.getTime()) || observedAt >= previous;
}

/** Build the per-device agent framework row, or null when none were found. */
export function buildFrameworkDiscovery(params: {
  device: EndpointDiscoveryDevice;
  frameworks: EndpointAgentFramework[];
  observedAt: Date;
}): DiscoveredAgentInput | null {
  const { device, frameworks, observedAt } = params;
  if (frameworks.length === 0) return null;

  const priority = Object.keys(AGENT_FRAMEWORK_LABELS);
  const ids = [...new Set(frameworks.map((f) => f.framework))].sort((a, b) => {
    const ia = priority.indexOf(a);
    const ib = priority.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
  });
  const labels = ids.map(frameworkLabel);

  const signals: AgentSignal[] = [
    {
      key: "framework_installed",
      label: `Agent framework installed: ${listNames(labels, 6)}`,
      weight: 25,
    },
  ];
  if (ids.length > 1) {
    signals.push({
      key: "multiple_frameworks",
      label: `${ids.length} agent frameworks installed`,
      weight: Math.min(15, 5 * (ids.length - 1)),
    });
  }
  const score = signals.reduce((sum, s) => sum + s.weight, 0);

  return {
    source: "endpoint_agent",
    externalId: frameworksExternalId(device.machineId),
    name: `Agent frameworks on ${device.hostname}`,
    description: `Agent development frameworks installed on ${device.hostname}: ${labels.join(", ")}. Installed, not necessarily running — look for the agent they are used to build.`,
    platform: "Local development",
    framework: ids[0],
    // An installed SDK is a lead, not a running agent: always low, no alert.
    confidence: "low",
    score,
    signals,
    userEmails: device.userEmail ? [device.userEmail] : [],
    ownerEmail: device.userEmail,
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
    suppressAlert: true,
    metadata: {
      kind: "agent_frameworks",
      deviceId: device.id,
      hostname: device.hostname,
      observedAt: observedAt.toISOString(),
      frameworks: [...frameworks]
        .sort((a, b) =>
          `${a.framework}|${a.ecosystem}|${a.source}`.localeCompare(
            `${b.framework}|${b.ecosystem}|${b.source}`,
          ),
        )
        .map((f) => ({
          framework: f.framework,
          ecosystem: f.ecosystem,
          source: f.source,
          count: f.count,
        })),
    },
  };
}
