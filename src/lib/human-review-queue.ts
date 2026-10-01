/**
 * The pending review queue, app side: what reviewers see and decide.
 * The proxies create requests and consume waivers (adjudicateHumanReview in
 * mcp-tool-activity.ts / tool-activity.ts); this module handles decisions,
 * listing and expiry.
 */
import type { HumanReviewStatus } from "@prisma/client";
import { prisma } from "./prisma";

export const PENDING_TTL_DAYS = 7;

export type WaiverScope = "exact" | "trigger";

export const WAIVER_DEFAULTS: Record<WaiverScope, { ttlMinutes: number; maxUses: number }> = {
  /** This exact call (same tool and arguments), once, within a day. */
  exact: { ttlMinutes: 24 * 60, maxUses: 1 },
  /** Any call matching the same trigger for the next hour, up to ten times. */
  trigger: { ttlMinutes: 60, maxUses: 10 },
};

export type WithheldCall = {
  tool: string;
  kind: string;
  trigger: string;
  detail: string;
  input: string;
  fingerprint: string;
};

export function parseCalls(value: unknown): WithheldCall[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({
      tool: String(c.tool ?? ""),
      kind: String(c.kind ?? ""),
      trigger: String(c.trigger ?? ""),
      detail: String(c.detail ?? ""),
      input: String(c.input ?? ""),
      fingerprint: String(c.fingerprint ?? ""),
    }));
}

const include = {
  agent: { select: { id: true, name: true, autonomyLevel: true, riskLevel: true, escalationContact: true } },
  decidedBy: { select: { name: true, email: true } },
} as const;

export async function listHumanReviews(options: { status?: HumanReviewStatus[]; agentId?: string; take?: number } = {}) {
  return prisma.humanReviewRequest.findMany({
    where: {
      ...(options.status ? { status: { in: options.status } } : {}),
      ...(options.agentId ? { agentId: options.agentId } : {}),
    },
    orderBy: [{ lastSeenAt: "desc" }],
    take: options.take ?? 100,
    include,
  });
}

export type HumanReviewRow = Awaited<ReturnType<typeof listHumanReviews>>[number];

/**
 * Pending requests past their TTL and approved waivers past their expiry
 * become EXPIRED. Run daily from the agent-baselines cron.
 */
export async function expireHumanReviews(now = new Date()) {
  const [pending, approved] = await Promise.all([
    prisma.humanReviewRequest.updateMany({
      where: { status: "PENDING", lastSeenAt: { lt: new Date(now.getTime() - PENDING_TTL_DAYS * 24 * 60 * 60 * 1000) } },
      data: { status: "EXPIRED" },
    }),
    prisma.humanReviewRequest.updateMany({
      where: { status: "APPROVED", expiresAt: { lt: now } },
      data: { status: "EXPIRED" },
    }),
  ]);
  return { expiredPending: pending.count, expiredWaivers: approved.count };
}
