import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const updateAlertSchema = z.object({
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"]).optional(),
  falsePositive: z.boolean().optional(),
  falsePositiveReason: z.string().min(1).max(2000).optional(),
  createException: z.boolean().optional(),
}).refine(
  (data) => !data.falsePositive || data.falsePositiveReason,
  { message: "falsePositiveReason is required when marking as false positive", path: ["falsePositiveReason"] }
).refine(
  (data) => data.status || data.falsePositive !== undefined,
  { message: "Either status or falsePositive must be provided" }
);

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const body = await req.json();
    const parsed = updateAlertSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const existing = await prisma.alert.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }

    // False positive marking
    if (parsed.data.falsePositive) {
      const metadata = existing.promptRiskMetadata as Record<string, unknown> | null;
      const ruleKeys = Array.isArray(metadata?.ruleKeys) ? (metadata.ruleKeys as string[]) : [];

      const result = await prisma.$transaction(async (tx) => {
        const updatedAlert = await tx.alert.update({
          where: { id },
          data: {
            status: "DISMISSED",
            falsePositive: true,
            falsePositiveReason: parsed.data.falsePositiveReason,
            falsePositiveByUserId: session.user.userId,
            falsePositiveAt: new Date(),
          },
        });

        // Create exceptions for each rule key if requested
        if (parsed.data.createException && ruleKeys.length > 0) {
          await tx.promptRiskException.createMany({
            data: ruleKeys.map((category) => ({
              category,
              reason: parsed.data.falsePositiveReason!,
              sourceAlertId: id,
              createdByUserId: session.user.userId,
            })),
          });
        }

        return updatedAlert;
      });

      await createAuditLog({
        userId: session.user.userId,
        action: "FALSE_POSITIVE",
        entityType: "Alert",
        entityId: id,
        changes: {
          falsePositive: true,
          reason: parsed.data.falsePositiveReason,
          exceptionsCreated: parsed.data.createException ? ruleKeys.length : 0,
        },
      });

      return NextResponse.json(result);
    }

    // Standard status update
    if (parsed.data.status) {
      const alert = await prisma.alert.update({
        where: { id },
        data: { status: parsed.data.status },
      });
      return NextResponse.json(alert);
    }

    return NextResponse.json({ error: "No update provided" }, { status: 400 });
  });
}
