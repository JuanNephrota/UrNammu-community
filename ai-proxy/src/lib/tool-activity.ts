/**
 * MCP tool activity recording for the Azure Functions proxy.
 *
 * PORT of the main app's `src/lib/mcp-tool-activity.ts` — the ai-proxy is a
 * separate project with its own Prisma client. Keep the semantics in sync:
 * one AgentToolCall per distinct tool invoked in a response, a first/last-seen
 * AgentToolProfile per (scope, server, tool), and alerts for unapproved and
 * never-seen-before tools.
 */

import { prisma } from "./db";
import type { LoadedAgent } from "./agent-loader";
import {
  dedupeToolUses,
  evaluateToolUses,
  isServerAllowed,
  scopeKeyFor,
  toolLabel,
  type DeclaredMcpServer,
  type ObservedToolUse,
} from "./mcp-tool-governance";
import { describeWithheldCalls, reviewFingerprint, waiverCovers } from "./review-fingerprint";
import {
  HUMAN_REVIEW_ALERT_SOURCE,
  evaluateHumanReviewTriggers,
  hasSensitiveDataTriggers,
  humanReviewDenialReasons,
  isEnforceableTrigger,
  matchedToolLabels,
  summarizeMatches,
  type HumanReviewMatch,
} from "./human-review-triggers";
import { analyzeText } from "./sensitive-detect";

export const MCP_ALERT_SOURCE = "mcp_tool_governance";
export const MCP_SERVER_DENIAL_RULE = "mcp_server_not_allowed";

const ALERT_DEDUPE_MS = 24 * 60 * 60 * 1000;

/** True when a matched trigger must withhold the response (buffer streams, 403). */
export function agentEnforcesReview(agent: LoadedAgent | null | undefined): agent is LoadedAgent {
  return (
    !!agent && agent.review.enforcement === "enforce" && agent.review.triggers.some(isEnforceableTrigger)
  );
}

/**
 * Evaluate an agent's human-review triggers against the tool calls a response
 * contained. `sensitive_data` triggers run the proxy's sensitive-data detector
 * over each call's arguments; everything else is pure.
 */
export async function evaluateAgentReviewTriggers(
  agent: LoadedAgent | null | undefined,
  uses: ObservedToolUse[]
): Promise<HumanReviewMatch[]> {
  if (!agent || uses.length === 0) return [];
  const triggers = agent.review.triggers.filter(isEnforceableTrigger);
  if (triggers.length === 0) return [];
  let sensitiveCategories: Array<string[] | null> | undefined;
  if (hasSensitiveDataTriggers(triggers)) {
    sensitiveCategories = await Promise.all(
      uses.map(async (use) => {
        if (use.input === undefined) return null;
        try {
          const analysis = await analyzeText(typeof use.input === "string" ? use.input : JSON.stringify(use.input));
          return analysis.flagged ? analysis.categories : [];
        } catch {
          return null;
        }
      })
    );
  }
  return evaluateHumanReviewTriggers(triggers, uses, { sensitiveCategories });
}

/**
 * Persist the outcome of matched human-review triggers: an enforced (response
 * withheld) or dry-run (monitor mode) PolicyDenial, plus one HIGH alert per
 * agent + trigger, deduped for 24 hours. PORT of the main app's version.
 */
export async function recordHumanReviewMatches(input: {
  agent: LoadedAgent;
  matches: HumanReviewMatch[];
  blocked: boolean;
  provider: string;
  model: string;
  aiSystemId: string | null;
  userEmail: string | null;
  department: string | null;
  requestId?: string | null;
  isStreaming: boolean;
  /** Pending review request the withheld calls were recorded under (enforce mode). */
  reviewRequestId?: string | null;
}): Promise<void> {
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

export async function recordToolActivity(input: {
  agent: LoadedAgent | null;
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
}): Promise<void> {
  if (input.declaredServers.length === 0 && input.toolUses.length === 0) return;
  try {
    const agentId = input.agent?.id ?? null;
    const aiSystemId = input.aiSystemId ?? input.agent?.aiSystemId ?? null;
    const scopeKey = scopeKeyFor(agentId, aiSystemId);
    const config = input.agent?.config ?? null;
    const uses = dedupeToolUses(input.toolUses);
    const verdicts = config ? evaluateToolUses(uses, config) : uses.map((use) => ({ use, allowed: true }));
    const reviewTools = matchedToolLabels(input.reviewMatches ?? []);
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

    type ProfileKey = {
      serverKey: string;
      toolName: string;
      kind: string;
      serverName: string | null;
      serverHost: string | null;
      approved: boolean;
    };
    const wanted = new Map<string, ProfileKey>();
    for (const server of input.declaredServers) {
      wanted.set(`${server.name}|*`, {
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
      wanted.set(`${serverKey}|${use.toolName}`, {
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
          data: {
            lastSeenAt: now,
            callCount: { increment: 1 },
            approved: profile.approved,
            kind: profile.kind,
            serverHost: profile.serverHost ?? undefined,
          },
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
      if (newTools.length) {
        parts.push(`tools: ${newTools.map((p) => toolLabel({ serverName: p.serverName, toolName: p.toolName })).join(", ")}`);
      }
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
  /** Matches with no waiver: the response is withheld. */
  withheld: HumanReviewMatch[];
  /** Matches an approved waiver covered; each use consumed one waiver use. */
  waived: HumanReviewMatch[];
  /** The pending request the withheld matches were recorded under. */
  request: { id: string; url: string | null } | null;
};

export function humanReviewUrl(id: string): string | null {
  const base = (process.env.NEXTAUTH_URL ?? process.env.URNAMMU_APP_URL ?? "").replace(/\/$/, "");
  return base ? `${base}/oversight/human-review?request=${id}` : null;
}

/**
 * Decide what to do with matched triggers in enforce mode: consume approved
 * waivers for the matches they cover, and record the rest as one pending
 * review request (identical re-runs collapse onto the same request). Fails
 * closed: on a DB error everything is withheld and no request id is returned.
 */
export async function adjudicateHumanReview(input: {
  agent: LoadedAgent;
  matches: HumanReviewMatch[];
  provider: string;
  model: string;
  requestId?: string | null;
  userEmail: string | null;
  department: string | null;
}): Promise<ReviewAdjudication> {
  const now = new Date();
  try {
    const setFingerprint = reviewFingerprint(input.matches);
    const waivers = await prisma.humanReviewRequest.findMany({
      where: { agentId: input.agent.id, status: "APPROVED", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      select: { id: true, waiverScope: true, fingerprint: true, triggers: true, expiresAt: true, usesRemaining: true },
    });
    const consumed = new Map<string, number>();
    const waived: HumanReviewMatch[] = [];
    const withheld: HumanReviewMatch[] = [];
    for (const match of input.matches) {
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
    if (withheld.length === 0) return { withheld, waived, request: null };

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
    return { withheld, waived, request: { id, url: humanReviewUrl(id) } };
  } catch (err) {
    console.error("adjudicateHumanReview failed; withholding everything:", err);
    return { withheld: input.matches, waived: [], request: null };
  }
}
