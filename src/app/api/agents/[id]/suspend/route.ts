import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";

const suspendSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
});

const select = {
  id: true,
  name: true,
  suspendedAt: true,
  suspendedReason: true,
  suspendedBy: { select: { name: true, email: true } },
} as const;

/**
 * POST /api/agents/[id]/suspend   Body: { reason? }
 *
 * The agent kill switch. Sets `suspendedAt`; from then on both proxies refuse
 * any request carrying this agent's `x-agent-id` with 403 and record an
 * enforced PolicyDenial (rule `agent_suspended`). Idempotent: suspending an
 * already-suspended agent keeps the original timestamp and actor.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const parsed = suspendSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    const existing = await prisma.aIAgent.findUnique({ where: { id }, select });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.suspendedAt) return NextResponse.json(existing);

    const reason = parsed.data.reason || null;
    const agent = await prisma.aIAgent.update({
      where: { id },
      data: { suspendedAt: new Date(), suspendedById: session.user.userId, suspendedReason: reason },
      select,
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "SUSPEND",
      entityType: "AIAgent",
      entityId: id,
      agentId: id,
      changes: { suspended: true, reason },
    });

    return NextResponse.json(agent);
  });
}

/**
 * DELETE /api/agents/[id]/suspend
 *
 * Resume: clears the kill switch so traffic flows again (subject to the
 * agent's status and MCP allowlists as before).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const existing = await prisma.aIAgent.findUnique({ where: { id }, select });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!existing.suspendedAt) return NextResponse.json(existing);

    const agent = await prisma.aIAgent.update({
      where: { id },
      data: { suspendedAt: null, suspendedById: null, suspendedReason: null },
      select,
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "RESUME",
      entityType: "AIAgent",
      entityId: id,
      agentId: id,
      changes: {
        suspended: false,
        previousSuspendedAt: existing.suspendedAt.toISOString(),
        previousReason: existing.suspendedReason,
      },
    });

    return NextResponse.json(agent);
  });
}
