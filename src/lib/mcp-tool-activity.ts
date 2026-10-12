/**
 * IO layer for MCP tool governance in the Next.js (Vercel fallback) proxy.
 * Mirrored for the Azure proxy in `ai-proxy/src/lib/tool-activity.ts`.
 *
 * Records what tools an agent's model calls actually invoked, keeps a
 * first-seen/last-seen profile per (scope, server, tool), and raises alerts
 * for tools outside the agent's allowlist and for tools never seen before.
 */

import { prisma } from "./prisma";
import {
  dedupeToolUses,
  evaluateToolUses,
  isServerAllowed,
  mergeCatalogIntoConfig,
  normalizeEnforcement,
  scopeKeyFor,
  toolLabel,
  type DeclaredMcpServer,
  type McpGovernanceConfig,
  type ObservedToolUse,
} from "./mcp-tool-governance";
import { agentBlockedDenialReason, type AgentBlockedVerdict } from "./agent-runtime-gate";
import { describeWithheldCalls, reviewFingerprint, waiverCovers } from "./review-fingerprint";
import {
  HUMAN_REVIEW_ALERT_SOURCE,
  SCOPE_ALERT_SOURCE,
  evaluateHumanReviewTriggers,
  hasSensitiveDataTriggers,
  humanReviewDenialReasons,
  isEnforceableTrigger,
  isScopeMatch,
  matchedToolLabels,
  normalizeHumanReviewTriggers,
  normalizeReviewEnforcement,
  summarizeMatches,
  type HumanReviewEnforcement,
  type HumanReviewMatch,
  type HumanReviewTrigger,
} from "./human-review-triggers";
import {
  evaluateAgentScope,
  normalizeAccessLevel,
  normalizeScopeEnforcement,
  normalizeToolAccess,
  type AgentScopeConfig,
  type ToolClassificationRule,
} from "./agent-scope";
import { analyzeText } from "./prompt-risk";

export const MCP_ALERT_SOURCE = "mcp_tool_governance";
export const MCP_SERVER_DENIAL_RULE = "mcp_server_not_allowed";

export type AgentGovernance = {
  id: string;
  name: string;
  aiSystemId: string | null;
  /** Lifecycle status and kill-switch timestamp; see agent-runtime-gate.ts. */
  status: string;
  suspendedAt: Date | null;
  config: McpGovernanceConfig;
  /** Human-review triggers and how a match is handled; see human-review-triggers.ts. */
  review: { triggers: HumanReviewTrigger[]; enforcement: HumanReviewEnforcement };
  /** Charter scope (access level, connected systems, classification rules); see agent-scope.ts. */
  scope: AgentScopeConfig;
};

/**
 * True when the agent's policy can withhold a response: enforced review
 * triggers or enforced charter scope. Handlers buffer streams and adjudicate
 * only for these agents; everyone else is monitor-only and forwards.
 */
export function agentWithholdsResponses(agent: AgentGovernance | null): agent is AgentGovernance {
  if (!agent) return false;
  if (agent.scope.enforcement === "enforce") return true;
  return agent.review.enforcement === "enforce" && agent.review.triggers.some(isEnforceableTrigger);
}

/** Active org-approved MCP catalog entries (server + tool patterns). */
export async function loadActiveCatalog(): Promise<Array<{ server: string; tools: string[] }>> {
  return prisma.mcpCatalogEntry.findMany({ where: { active: true }, select: { server: true, tools: true } });
}

/** Org-wide tool classification rules (ToolClassification rows). */
export async function loadToolClassifications(): Promise<ToolClassificationRule[]> {
  const rows = await prisma.toolClassification.findMany({ select: { server: true, tool: true, access: true, system: true } });
  const out: ToolClassificationRule[] = [];
  for (const row of rows) {
    const access = normalizeToolAccess(row.access);
    if (access) out.push({ server: row.server, tool: row.tool, access, system: row.system });
  }
  return out;
}

export async function loadAgentGovernance(agentId: string | null): Promise<AgentGovernance | null> {
  if (!agentId) return null;
  try {
    const agent = await prisma.aIAgent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        name: true,
        aiSystemId: true,
        mcpServerAllowlist: true,
        mcpToolAllowlist: true,
        mcpEnforcement: true,
        status: true,
        suspendedAt: true,
        humanReviewTriggers: true,
        humanReviewEnforcement: true,
        inheritMcpCatalog: true,
        accessLevel: true,
        connectedSystems: true,
        scopeEnforcement: true,
      },
    });
    if (!agent) return null;
    const own = {
      serverAllowlist: agent.mcpServerAllowlist,
      toolAllowlist: agent.mcpToolAllowlist,
      enforcement: normalizeEnforcement(agent.mcpEnforcement),
    };
    const config = agent.inheritMcpCatalog ? mergeCatalogIntoConfig(own, await loadActiveCatalog()) : own;
    return {
      id: agent.id,
      name: agent.name,
      aiSystemId: agent.aiSystemId,
      status: agent.status,
      suspendedAt: agent.suspendedAt,
      config,
      review: {
        triggers: normalizeHumanReviewTriggers(agent.humanReviewTriggers),
        enforcement: normalizeReviewEnforcement(agent.humanReviewEnforcement),
      },
      scope: {
        accessLevel: normalizeAccessLevel(agent.accessLevel),
        connectedSystems: Array.isArray(agent.connectedSystems)
          ? agent.connectedSystems.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          : [],
        enforcement: normalizeScopeEnforcement(agent.scopeEnforcement),
        toolAllowlist: agent.mcpToolAllowlist,
        rules: await loadToolClassifications(),
      },
    };
  } catch (err) {
    console.error("loadAgentGovernance failed:", err);
    return null;
  }
}

export async function logMcpServerDenial(input: {
  provider: string;
  model: string;
  agent: AgentGovernance;
  aiSystemId: string | null;
  userEmail: string | null;
  department: string | null;
  deniedServers: DeclaredMcpServer[];
  isStreaming: boolean;
}) {
  try {
    await prisma.policyDenial.create({
      data: {
        provider: input.provider,
        model: input.model,
        aiSystemId: input.aiSystemId,
        userEmail: input.userEmail,
        department: input.department,
        mode: input.agent.config.enforcement === "enforce" ? "enforced" : "dryrun",
        policyIds: [],
        reasons: input.deniedServers.map((server) => ({
          ruleKey: MCP_SERVER_DENIAL_RULE,
          message: `MCP server "${server.name}"${server.host ? ` (${server.host})` : ""} is not on the allowlist for agent "${input.agent.name}".`,
          policyId: input.agent.id,
          policyName: `Agent MCP allowlist: ${input.agent.name}`,
        })),
        promptExcerpt: null,
        requestMetadata: {
          isStreaming: input.isStreaming,
          agentId: input.agent.id,
          deniedServers: input.deniedServers.map((s) => ({ name: s.name, host: s.host })),
        },
      },
    });
  } catch (err) {
    console.error("logMcpServerDenial failed:", err);
  }
}

export const MCP_TOOL_DENIAL_RULE = "mcp_tool_not_allowed";

/**
 * Records tool calls a policy check refused for being outside the agent's
 * MCP allowlists (the proxies cannot refuse these: they only see such calls
 * once the provider has already executed them, and raise alerts instead).
 */
export async function logMcpToolDenials(input: {
  provider: string;
  agent: AgentGovernance;
  aiSystemId: string | null;
  userEmail: string | null;
  department: string | null;
  uses: ObservedToolUse[];
  serverDenied: string[];
}) {
  if (input.uses.length === 0) return;
  try {
    await prisma.policyDenial.create({
      data: {
        provider: input.provider,
        model: input.provider,
        aiSystemId: input.aiSystemId,
        userEmail: input.userEmail,
        department: input.department,
        mode: input.agent.config.enforcement === "enforce" ? "enforced" : "dryrun",
        policyIds: [],
        reasons: input.uses.map((use) =>
          use.serverName && input.serverDenied.includes(use.serverName)
            ? {
                ruleKey: MCP_SERVER_DENIAL_RULE,
                message: `MCP server "${use.serverName}" is not on the allowlist for agent "${input.agent.name}".`,
                policyId: input.agent.id,
                policyName: `Agent MCP allowlist: ${input.agent.name}`,
              }
            : {
                ruleKey: MCP_TOOL_DENIAL_RULE,
                message: `Tool ${toolLabel(use)} is not on the MCP allowlist for agent "${input.agent.name}".`,
                policyId: input.agent.id,
                policyName: `Agent MCP allowlist: ${input.agent.name}`,
              }
        ),
        promptExcerpt: null,
        requestMetadata: { agentId: input.agent.id, tools: input.uses.map(toolLabel).slice(0, 50) },
      },
    });
  } catch (err) {
    console.error("logMcpToolDenials failed:", err);
  }
}

/** Records a request refused by the agent kill switch (suspended or retired agent). */
export async function logAgentBlockedDenial(input: {
  provider: string;
  agent: AgentGovernance;
  verdict: AgentBlockedVerdict;
  aiSystemId: string | null;
  userEmail: string | null;
  department: string | null;
}) {
  try {
    await prisma.policyDenial.create({
      data: {
        provider: input.provider,
        model: "unknown",
        aiSystemId: input.aiSystemId,
        userEmail: input.userEmail,
        department: input.department,
        mode: "enforced",
        policyIds: [],
        reasons: [agentBlockedDenialReason(input.agent, input.verdict)],
        promptExcerpt: null,
        requestMetadata: { agentId: input.agent.id, agentStatus: input.agent.status },
      },
    });
  } catch (err) {
    console.error("logAgentBlockedDenial failed:", err);
  }
}

/**
 * Evaluate an agent's tool policy against the tool calls a response
 * contained: human-review triggers (`sensitive_data` triggers run the
 * proxy's response-DLP detector over each call's arguments; everything else
 * is pure) plus charter-scope violations (agent-scope.ts). Scope matches are
 * distinguishable with `isScopeMatch()`.
 */
export async function evaluateAgentToolPolicy(
  agent: AgentGovernance | null,
  uses: ObservedToolUse[]
): Promise<HumanReviewMatch[]> {
  if (!agent || uses.length === 0) return [];
  const scopeMatches = evaluateAgentScope(agent.scope, uses);
  const triggers = agent.review.triggers.filter(isEnforceableTrigger);
  if (triggers.length === 0) return scopeMatches;
  let sensitiveCategories: Array<string[] | null> | undefined;
  if (hasSensitiveDataTriggers(triggers)) {
    sensitiveCategories = await Promise.all(
      uses.map(async (use) => {
        if (use.input === undefined) return null;
        try {
          const analysis = await analyzeText(
            typeof use.input === "string" ? use.input : JSON.stringify(use.input),
            { excludeIntentRules: true }
          );
          return analysis.flagged ? analysis.categories : [];
        } catch {
          return null;
        }
      })
    );
  }
  return [...evaluateHumanReviewTriggers(triggers, uses, { sensitiveCategories }), ...scopeMatches];
}

/**
 * Persist the outcome of matched human-review triggers: an enforced (response
 * withheld) or dry-run (monitor mode) PolicyDenial, plus one HIGH alert per
 * agent + trigger, deduped for 24 hours.
 */
export async function recordHumanReviewMatches(input: {
  agent: AgentGovernance;
  matches: HumanReviewMatch[];
  blocked: boolean;
  provider: string;
  model: string;
  aiSystemId: string | null;
  userEmail: string | null;
  department: string | null;
  requestId?: string | null;
  /** Null when the recorder does not know (monitor-mode matches recorded during adjudication). */
  isStreaming: boolean | null;
  /** Pending review request the withheld calls were recorded under (enforce mode). */
  reviewRequestId?: string | null;
}) {
  if (input.matches.length === 0) return;
  const aiSystemId = input.aiSystemId ?? input.agent.aiSystemId ?? null;
  try {
    await prisma.policyDenial.create({
      data: {
        provider: input.provider,
        model: input.model,
        aiSystemId,
        userEmail: input.userEmail,
        department: input.department,
        mode: input.blocked ? "enforced" : "dryrun",
        policyIds: [],
        reasons: humanReviewDenialReasons(input.agent, input.matches),
        promptExcerpt: null,
        requestMetadata: {
          agentId: input.agent.id,
          isStreaming: input.isStreaming,
          blocked: input.blocked,
          requestId: input.requestId ?? null,
          reviewRequestId: input.reviewRequestId ?? null,
          matches: summarizeMatches(input.matches),
        },
      },
    });
  } catch (err) {
    console.error("recordHumanReviewMatches (denial) failed:", err);
  }
  try {
    const byTrigger = new Map<string, HumanReviewMatch[]>();
    for (const m of input.matches) byTrigger.set(m.triggerLabel, [...(byTrigger.get(m.triggerLabel) ?? []), m]);
    for (const [label, group] of byTrigger) {
      const tools = [...new Set(group.map((m) => m.tool))].join(", ");
      if (group.every(isScopeMatch)) {
        await upsertAlert({
          source: SCOPE_ALERT_SOURCE,
          title: `Out-of-scope tool call: ${input.agent.name} — ${label}`,
          description: `${input.blocked ? "Response withheld (scope enforce mode)." : "Observed in scope monitor mode; the call was forwarded."} Agent "${input.agent.name}" called ${tools} via ${input.provider}/${input.model}: ${group
            .map((m) => m.detail)
            .join("; ")}. Reclassify the tool on the agent's MCP card (or Oversight → MCP Activity → Tool classifications), or change the agent's access level / connected systems. Scope violations are not waivable.`,
          severity: "HIGH",
          aiSystemId,
        });
        continue;
      }
      await upsertAlert({
        source: HUMAN_REVIEW_ALERT_SOURCE,
        title: `Human review required: ${input.agent.name} — ${label}`,
        description: `${input.blocked ? "Response withheld (enforce mode)." : "Observed in monitor mode; the call was forwarded."} Agent "${input.agent.name}" called ${tools} via ${input.provider}/${input.model}: ${group
          .map((m) => m.detail)
          .join("; ")}. ${
          input.reviewRequestId
            ? `Pending review ${input.reviewRequestId}: approve or reject it under Oversight → Human Review; approving lets the agent through when it re-runs the call.`
            : "Review the agent's Human Review card and decide whether to adjust the trigger or suspend the agent."
        }`,
        severity: "HIGH",
        aiSystemId,
      });
    }
  } catch (err) {
    console.error("recordHumanReviewMatches (alert) failed:", err);
  }
}

const ALERT_DEDUPE_MS = 24 * 60 * 60 * 1000;

async function upsertAlert(input: {
  title: string;
  description: string;
  severity: "HIGH" | "MEDIUM";
  aiSystemId: string | null;
  source?: string;
}) {
  const source = input.source ?? MCP_ALERT_SOURCE;
  const recent = await prisma.alert.findFirst({
    where: {
      source,
      title: input.title,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
      createdAt: { gte: new Date(Date.now() - ALERT_DEDUPE_MS) },
    },
    select: { id: true },
  });
  if (recent) {
    await prisma.alert.update({
      where: { id: recent.id },
      data: { description: input.description, severity: input.severity },
    });
    return;
  }
  await prisma.alert.create({
    data: {
      title: input.title,
      description: input.description,
      severity: input.severity,
      source,
      aiSystemId: input.aiSystemId,
    },
  });
}

/**
 * Persist one request's tool activity. Safe to call with empty inputs (no-op).
 * Never throws — failures are logged so the proxy response is unaffected.
 */
export async function recordToolActivity(input: {
  agent: AgentGovernance | null;
  aiSystemId: string | null;
  provider: string;
  model: string;
  requestId?: string | null;
  userEmail: string | null;
  department: string | null;
  declaredServers: DeclaredMcpServer[];
  toolUses: ObservedToolUse[];
  /** Human-review trigger matches for this response; flags the matching rows. */
  reviewMatches?: HumanReviewMatch[];
}) {
  if (input.declaredServers.length === 0 && input.toolUses.length === 0) return;
  try {
    const agentId = input.agent?.id ?? null;
    const aiSystemId = input.aiSystemId ?? input.agent?.aiSystemId ?? null;
    const scopeKey = scopeKeyFor(agentId, aiSystemId);
    const config = input.agent?.config ?? null;
    const uses = dedupeToolUses(input.toolUses);
    const verdicts = config ? evaluateToolUses(uses, config) : uses.map((use) => ({ use, allowed: true }));
    const reviewTools = matchedToolLabels((input.reviewMatches ?? []).filter((m) => !isScopeMatch(m)));
    const now = new Date();

    if (verdicts.length > 0) {
      await prisma.agentToolCall.createMany({
        data: verdicts.map(({ use, allowed }) => ({
          agentId,
          aiSystemId,
          provider: input.provider,
          model: input.model,
          kind: use.kind,
          serverName: use.serverName,
          toolName: use.toolName,
          approved: allowed,
          reviewRequired: reviewTools.has(toolLabel(use)),
          requestId: input.requestId ?? null,
          userEmail: input.userEmail,
          department: input.department,
        })),
      });
    }

    // Profiles: declared servers (toolName "*") + each observed tool.
    type ProfileKey = { serverKey: string; toolName: string; kind: string; serverName: string | null; serverHost: string | null; approved: boolean };
    const wanted = new Map<string, ProfileKey>();
    for (const server of input.declaredServers) {
      const key = `${server.name}|*`;
      wanted.set(key, {
        serverKey: server.name,
        toolName: "*",
        kind: "mcp_server",
        serverName: server.name,
        serverHost: server.host,
        approved: config ? isServerAllowed(server, config.serverAllowlist) : true,
      });
    }
    for (const { use, allowed } of verdicts) {
      const serverKey = use.serverName ?? "-";
      const key = `${serverKey}|${use.toolName}`;
      wanted.set(key, {
        serverKey,
        toolName: use.toolName,
        kind: use.kind,
        serverName: use.serverName,
        serverHost: input.declaredServers.find((s) => s.name === use.serverName)?.host ?? null,
        approved: allowed,
      });
    }
    if (wanted.size === 0) return;

    const existing = await prisma.agentToolProfile.findMany({
      where: {
        scopeKey,
        OR: Array.from(wanted.values()).map((p) => ({ serverKey: p.serverKey, toolName: p.toolName })),
      },
      select: { id: true, serverKey: true, toolName: true },
    });
    const existingByKey = new Map(existing.map((p) => [`${p.serverKey}|${p.toolName}`, p.id]));

    const firstSeen: ProfileKey[] = [];
    for (const [key, profile] of wanted) {
      const id = existingByKey.get(key);
      if (id) {
        await prisma.agentToolProfile.update({
          where: { id },
          data: { lastSeenAt: now, callCount: { increment: 1 }, approved: profile.approved, kind: profile.kind, serverHost: profile.serverHost ?? undefined },
        });
      } else {
        await prisma.agentToolProfile.upsert({
          where: { scopeKey_serverKey_toolName: { scopeKey, serverKey: profile.serverKey, toolName: profile.toolName } },
          update: { lastSeenAt: now, callCount: { increment: 1 }, approved: profile.approved },
          create: {
            scopeKey,
            agentId,
            aiSystemId,
            serverKey: profile.serverKey,
            serverName: profile.serverName,
            serverHost: profile.serverHost,
            toolName: profile.toolName,
            kind: profile.kind,
            approved: profile.approved,
            callCount: 1,
            firstSeenAt: now,
            lastSeenAt: now,
          },
        });
        firstSeen.push(profile);
      }
    }

    // Alerts only make sense when the traffic is attributed to something.
    if (!agentId && !aiSystemId) return;
    const subject = input.agent ? `agent "${input.agent.name}"` : `system ${aiSystemId}`;

    const unapproved = verdicts.filter((v) => !v.allowed);
    if (unapproved.length > 0) {
      const labels = unapproved.map((v) => toolLabel(v.use));
      const mode = input.agent?.config.enforcement === "enforce" ? "enforce" : "monitor";
      await upsertAlert({
        title: `Unapproved MCP tool invoked by ${input.agent?.name ?? aiSystemId}`,
        description: `${subject} invoked ${labels.join(", ")} via ${input.provider}/${input.model}, which is outside its MCP allowlist (${mode} mode). Approve the tool on the agent page or tighten the request's allowed_tools.`,
        severity: "HIGH",
        aiSystemId,
      });
    }

    const newTools = firstSeen.filter((p) => p.kind !== "mcp_server" && p.approved);
    const newServers = firstSeen.filter((p) => p.kind === "mcp_server" && p.approved);
    if (newTools.length > 0 || newServers.length > 0) {
      const parts: string[] = [];
      if (newServers.length) parts.push(`servers: ${newServers.map((p) => p.serverKey).join(", ")}`);
      if (newTools.length) parts.push(`tools: ${newTools.map((p) => toolLabel({ serverName: p.serverName, toolName: p.toolName })).join(", ")}`);
      await upsertAlert({
        title: `New MCP tool activity for ${input.agent?.name ?? aiSystemId}`,
        description: `First time ${subject} was observed using ${parts.join("; ")} (${input.provider}/${input.model}). Review on the agent page and add to the allowlist if expected.`,
        severity: "MEDIUM",
        aiSystemId,
      });
    }
  } catch (err) {
    console.error("recordToolActivity failed:", err);
  }
}

// ─── Pending review queue ──────────────────────────────────────────────────

export type ReviewAdjudication = {
  /** Matches with no waiver (or scope violations in enforce mode): the response is withheld. */
  withheld: HumanReviewMatch[];
  /** Matches an approved waiver covered; each use consumed one waiver use. */
  waived: HumanReviewMatch[];
  /**
   * Matches whose dimension is in monitor mode while the other is enforced;
   * already recorded as dry-run denials here, so handlers need not.
   */
  monitored: HumanReviewMatch[];
  /** The pending request the withheld review matches were recorded under. */
  request: { id: string; url: string | null } | null;
};

export function humanReviewUrl(id: string): string | null {
  const base = (process.env.NEXTAUTH_URL ?? process.env.URNAMMU_APP_URL ?? "").replace(/\/$/, "");
  return base ? `${base}/oversight/human-review?request=${id}` : null;
}

/**
 * Decide what to do with matched triggers when the agent withholds
 * responses: scope violations are withheld outright in scope enforce mode
 * (never waived, never queued); review matches consume approved waivers for
 * the calls they cover and the rest become one pending review request
 * (identical re-runs collapse onto the same request). Whichever dimension is
 * still in monitor mode has its matches recorded as dry-run denials here and
 * returned as `monitored`. Fails closed: on a DB error every enforced match
 * is withheld and no request id is returned.
 */
export async function adjudicateHumanReview(input: {
  agent: AgentGovernance;
  matches: HumanReviewMatch[];
  provider: string;
  model: string;
  requestId?: string | null;
  userEmail: string | null;
  department: string | null;
}): Promise<ReviewAdjudication> {
  const now = new Date();
  const scopeMatches = input.matches.filter(isScopeMatch);
  const reviewMatches = input.matches.filter((m) => !isScopeMatch(m));
  const scopeEnforced = input.agent.scope.enforcement === "enforce";
  const reviewEnforced =
    input.agent.review.enforcement === "enforce" && input.agent.review.triggers.some(isEnforceableTrigger);
  const monitored = [...(scopeEnforced ? [] : scopeMatches), ...(reviewEnforced ? [] : reviewMatches)];
  if (monitored.length > 0) {
    await recordHumanReviewMatches({
      agent: input.agent,
      matches: monitored,
      blocked: false,
      provider: input.provider,
      model: input.model,
      aiSystemId: input.agent.aiSystemId,
      userEmail: input.userEmail,
      department: input.department,
      requestId: input.requestId,
      isStreaming: null,
    });
  }
  const scopeWithheld = scopeEnforced ? scopeMatches : [];
  if (!reviewEnforced || reviewMatches.length === 0) {
    return { withheld: scopeWithheld, waived: [], monitored, request: null };
  }
  try {
    const setFingerprint = reviewFingerprint(reviewMatches);
    const waivers = await prisma.humanReviewRequest.findMany({
      where: { agentId: input.agent.id, status: "APPROVED", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      select: { id: true, waiverScope: true, fingerprint: true, triggers: true, expiresAt: true, usesRemaining: true },
    });
    const consumed = new Map<string, number>();
    const waived: HumanReviewMatch[] = [];
    const withheld: HumanReviewMatch[] = [];
    for (const match of reviewMatches) {
      const waiver = waivers.find(
        (w) =>
          (w.usesRemaining === null || w.usesRemaining - (consumed.get(w.id) ?? 0) > 0) &&
          waiverCovers(w, match, setFingerprint, now)
      );
      if (waiver) {
        waived.push(match);
        consumed.set(waiver.id, (consumed.get(waiver.id) ?? 0) + 1);
      } else {
        withheld.push(match);
      }
    }
    for (const [id, uses] of consumed) {
      const waiver = waivers.find((w) => w.id === id)!;
      const remaining = waiver.usesRemaining === null ? null : waiver.usesRemaining - uses;
      await prisma.humanReviewRequest.update({
        where: { id },
        data: {
          usesRemaining: remaining,
          lastWaivedAt: now,
          status: remaining !== null && remaining <= 0 ? "CONSUMED" : "APPROVED",
        },
      });
    }
    if (withheld.length === 0) return { withheld: scopeWithheld, waived, monitored, request: null };

    const fingerprint = reviewFingerprint(withheld);
    const existing = await prisma.humanReviewRequest.findFirst({
      where: { agentId: input.agent.id, fingerprint, status: "PENDING" },
      select: { id: true },
    });
    let id: string;
    if (existing) {
      await prisma.humanReviewRequest.update({
        where: { id: existing.id },
        data: { occurrences: { increment: 1 }, lastSeenAt: now, requestId: input.requestId ?? undefined },
      });
      id = existing.id;
    } else {
      const created = await prisma.humanReviewRequest.create({
        data: {
          agentId: input.agent.id,
          provider: input.provider,
          model: input.model,
          fingerprint,
          triggers: [...new Set(withheld.map((m) => m.triggerLabel))],
          calls: describeWithheldCalls(withheld),
          requestId: input.requestId ?? null,
          userEmail: input.userEmail,
          department: input.department,
        },
        select: { id: true },
      });
      id = created.id;
    }
    return { withheld: [...withheld, ...scopeWithheld], waived, monitored, request: { id, url: humanReviewUrl(id) } };
  } catch (err) {
    console.error("adjudicateHumanReview failed; withholding everything:", err);
    return { withheld: [...reviewMatches, ...scopeWithheld], waived: [], monitored, request: null };
  }
}
