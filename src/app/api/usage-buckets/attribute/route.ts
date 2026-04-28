import { NextRequest, NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const requestSchema = z.object({
  bucketIds: z.array(z.string()).min(1).max(500),
  aiSystemId: z.string().nullable(),
});

export async function PUT(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const { bucketIds, aiSystemId } = parsed.data;

    // Verify the AI system exists if linking (not clearing)
    if (aiSystemId) {
      const system = await prisma.aISystem.findUnique({
        where: { id: aiSystemId },
        select: { id: true, name: true },
      });
      if (!system) {
        return NextResponse.json({ error: "AI system not found" }, { status: 404 });
      }
    }

    const result = await prisma.usageBucket.updateMany({
      where: { id: { in: bucketIds } },
      data: { aiSystemId },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "UPDATE",
      entityType: "UsageBucket",
      entityId: aiSystemId ?? "cleared",
      changes: {
        type: aiSystemId ? "usage_attribution_linked" : "usage_attribution_cleared",
        aiSystemId,
        bucketCount: result.count,
      },
    });

    return NextResponse.json({ updated: result.count });
  });
}
