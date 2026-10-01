import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { WAIVER_DEFAULTS } from "@/lib/human-review-queue";

const decisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  /** exact = this call (same tool + arguments); trigger = any call matching the same trigger. */
  scope: z.enum(["exact", "trigger"]).default("exact"),
  ttlMinutes: z.coerce.number().int().min(5).max(7 * 24 * 60).optional(),
  maxUses: z.coerce.number().int().min(1).max(1000).optional(),
  note: z.string().trim().max(2000).optional(),
});

/**
 * POST /api/human-review/[id]/decision
 *
 * Approve or reject a withheld call. Approving records a waiver the proxies
 * honour when the agent re-runs the call: "exact" covers the same tool and
 * arguments (default once, 24 h); "trigger" covers any call matching the same
 * trigger (default 10 uses, 1 h). Nothing is replayed: the agent, or whoever
 * runs it, re-issues the request.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const parsed = decisionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    const existing = await prisma.humanReviewRequest.findUnique({ where: { id }, include: { agent: { select: { name: true } } } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.status !== "PENDING") {
      return NextResponse.json({ error: `This request is already ${existing.status.toLowerCase()}.` }, { status: 409 });
    }

    const { decision, scope, note } = parsed.data;
    const defaults = WAIVER_DEFAULTS[scope];
    const ttlMinutes = parsed.data.ttlMinutes ?? defaults.ttlMinutes;
    const maxUses = parsed.data.maxUses ?? defaults.maxUses;
    const now = new Date();

    const updated = await prisma.humanReviewRequest.update({
      where: { id },
      data: {
        status: decision,
        decidedById: session.user.userId,
        decidedAt: now,
        decisionNote: note || null,
        ...(decision === "APPROVED"
          ? {
              waiverScope: scope,
              expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
              usesRemaining: maxUses,
            }
          : { waiverScope: null, expiresAt: null, usesRemaining: null }),
      },
      include: { agent: { select: { id: true, name: true } }, decidedBy: { select: { name: true, email: true } } },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: decision === "APPROVED" ? "APPROVE_REVIEW" : "REJECT_REVIEW",
      entityType: "HumanReviewRequest",
      entityId: id,
      agentId: existing.agentId,
      changes: {
        agent: existing.agent.name,
        triggers: existing.triggers,
        occurrences: existing.occurrences,
        ...(decision === "APPROVED" ? { scope, ttlMinutes, maxUses } : {}),
        note: note ?? null,
      },
    });

    return NextResponse.json(updated);
  });
}
