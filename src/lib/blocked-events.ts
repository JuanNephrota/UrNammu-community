/**
 * Unified reader for "blocked queries" — events where *we* rejected or
 * flagged a request. Combines two underlying sources that share the same
 * operational meaning but live in different tables:
 *
 *   - `PolicyDenial` rows written by the Azure Functions proxy's
 *     policy-as-code enforcement.
 *   - `Alert` rows with `source = "dangerous_prompt"` written by the
 *     Vercel fallback proxy's prompt-risk rules.
 *
 * We deliberately do NOT include `APIUsageLog` rows with
 * `flagCategory = "upstream_error"` / `"proxy_error"` — those are
 * operational failures at the upstream provider, not blocks we made.
 *
 * Prisma can't cleanly UNION across these two shapes, so we fetch each in
 * parallel, normalize to a common `BlockedEvent` shape, merge, sort by
 * timestamp, and paginate in-memory. Safe at expected volume (hundreds
 * per day at most); if that changes we can materialize a view.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type BlockedEventSource = "policy" | "content";

export type BlockedEventFilter = {
  since: Date;
  until?: Date;
  aiSystemId?: string;
  policyId?: string;
  source?: BlockedEventSource;
};

export type BlockedEvent = {
  id: string;
  source: BlockedEventSource;
  createdAt: Date;
  // For policy: mode ("enforced" | "dryrun"). For content: "blocked" (prompt
  // risk always blocks in the fallback proxy today).
  modeLabel: string;
  provider: string | null;
  model: string | null;
  aiSystemId: string | null;
  userEmail: string | null;
  department: string | null;
  policyIds: string[];
  primaryReason: string;
  reasonCount: number;
  /** Link target for the detail view — varies per source. */
  detailHref: string;
};

type PolicyDenialRow = Awaited<ReturnType<typeof prisma.policyDenial.findMany>>[number];
type AlertRow = Awaited<ReturnType<typeof prisma.alert.findMany>>[number];

function normalizePolicyDenial(row: PolicyDenialRow): BlockedEvent {
  type Reason = { ruleKey: string; message: string; policyId: string; policyName: string };
  const reasons: Reason[] = Array.isArray(row.reasons) ? (row.reasons as unknown as Reason[]) : [];
  return {
    id: `policy:${row.id}`,
    source: "policy",
    createdAt: row.createdAt,
    modeLabel: row.mode, // "enforced" | "dryrun"
    provider: row.provider,
    model: row.model,
    aiSystemId: row.aiSystemId,
    userEmail: row.userEmail,
    department: row.department,
    policyIds: row.policyIds,
    primaryReason: reasons[0]?.message ?? "(no reason recorded)",
    reasonCount: reasons.length,
    detailHref: `/compliance/denials/${row.id}`,
  };
}

function normalizeAlert(row: AlertRow): BlockedEvent {
  // The Vercel proxy stashes prompt-risk data in `promptRiskMetadata`. We
  // pull the first matched rule's label as the primary reason when present.
  const meta = row.promptRiskMetadata as
    | {
        ruleMatches?: Array<{ label?: string; key?: string; severity?: string }>;
        categories?: string[];
        userEmail?: string;
        department?: string;
        provider?: string;
        model?: string;
      }
    | null
    | undefined;
  const firstMatch = meta?.ruleMatches?.[0];
  const primaryReason =
    firstMatch?.label ??
    (meta?.categories?.length ? meta.categories.join(", ") : row.description) ??
    row.title;
  return {
    id: `content:${row.id}`,
    source: "content",
    createdAt: row.createdAt,
    modeLabel: "blocked",
    provider: meta?.provider ?? null,
    model: meta?.model ?? null,
    aiSystemId: row.aiSystemId,
    userEmail: meta?.userEmail ?? null,
    department: meta?.department ?? null,
    policyIds: [],
    primaryReason,
    reasonCount: meta?.ruleMatches?.length ?? 1,
    // No standalone URL for dangerous-prompt alerts today — /alerts renders
    // the detail inline. Deep-link into the alerts page with a hash so the
    // user's scroll lands on the right row.
    detailHref: `/alerts#alert-${row.id}`,
  };
}

export async function listBlockedEvents(
  filter: BlockedEventFilter,
  { skip = 0, take = 50 }: { skip?: number; take?: number } = {}
): Promise<{ items: BlockedEvent[]; total: number }> {
  const dateRange: Prisma.DateTimeFilter = { gte: filter.since };
  if (filter.until) dateRange.lte = filter.until;

  const wantPolicy = filter.source === undefined || filter.source === "policy";
  const wantContent = filter.source === undefined || filter.source === "content";

  const policyWhere: Prisma.PolicyDenialWhereInput = {
    createdAt: dateRange,
    ...(filter.aiSystemId ? { aiSystemId: filter.aiSystemId } : {}),
    ...(filter.policyId ? { policyIds: { has: filter.policyId } } : {}),
  };
  const alertWhere: Prisma.AlertWhereInput = {
    source: "dangerous_prompt",
    createdAt: dateRange,
    ...(filter.aiSystemId ? { aiSystemId: filter.aiSystemId } : {}),
    // Policy filter doesn't apply to content blocks. When the user has
    // selected a specific policy, content blocks must be excluded.
  };

  // When filtering by a specific policy, content blocks (which have no
  // policy) should be excluded entirely.
  const effectiveWantContent = wantContent && !filter.policyId;

  const [policyRows, policyCount, alertRows, alertCount] = await Promise.all([
    wantPolicy
      ? prisma.policyDenial.findMany({
          where: policyWhere,
          orderBy: { createdAt: "desc" },
          // Pull the slice we might need; merge step handles ordering.
          take: skip + take + 100,
        })
      : Promise.resolve([]),
    wantPolicy ? prisma.policyDenial.count({ where: policyWhere }) : 0,
    effectiveWantContent
      ? prisma.alert.findMany({
          where: alertWhere,
          orderBy: { createdAt: "desc" },
          take: skip + take + 100,
        })
      : Promise.resolve([]),
    effectiveWantContent ? prisma.alert.count({ where: alertWhere }) : 0,
  ]);

  const merged = [
    ...policyRows.map(normalizePolicyDenial),
    ...alertRows.map(normalizeAlert),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const items = merged.slice(skip, skip + take);
  return { items, total: policyCount + alertCount };
}
