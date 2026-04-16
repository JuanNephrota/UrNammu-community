import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { classifyDiscoveredTool } from "@/lib/ai-classification";

const updateDiscoveredToolSchema = z.object({
  status: z.enum([
    "DISCOVERED",
    "UNDER_REVIEW",
    "REGISTERED",
    "BLOCKED",
    "APPROVED",
  ]),
  notes: z.string().max(2000).nullish(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const body = await req.json();

    // Handle promote low-confidence candidate to main discovery queue
    if (body.action === "promote") {
      const tool = await prisma.discoveredAITool.findUnique({ where: { id } });
      if (!tool) return NextResponse.json({ error: "Not found" }, { status: 404 });

      const updated = await prisma.discoveredAITool.update({
        where: { id },
        data: {
          matchConfidence: "high",
          notes: tool.notes
            ? `${tool.notes}\nManually promoted from low-confidence queue.`
            : "Manually promoted from low-confidence queue.",
        },
      });

      await createAuditLog({
        userId: session.user.userId,
        action: "PROMOTE",
        entityType: "DiscoveredAITool",
        entityId: id,
        changes: { fromConfidence: tool.matchConfidence, toConfidence: "high" },
      });

      return NextResponse.json(updated);
    }

    // Handle dismiss candidate (permanently suppress from future scans)
    if (body.action === "dismiss_candidate") {
      const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;
      if (!reason) {
        return NextResponse.json({ error: "reason is required for dismissal" }, { status: 400 });
      }

      const tool = await prisma.discoveredAITool.findUnique({ where: { id } });
      if (!tool) return NextResponse.json({ error: "Not found" }, { status: 404 });

      await prisma.$transaction(async (tx) => {
        // Create DismissedCandidate to prevent resurfacing
        await tx.dismissedCandidate.upsert({
          where: { toolName_detectedDomain: { toolName: tool.toolName, detectedDomain: tool.detectedDomain ?? "" } },
          update: { reason, dismissedByUserId: session.user.userId },
          create: {
            toolName: tool.toolName,
            vendor: tool.vendor,
            detectedDomain: tool.detectedDomain,
            reason,
            dismissedByUserId: session.user.userId,
          },
        });
        // Remove the discovery record
        await tx.discoveredAITool.delete({ where: { id } });
      });

      await createAuditLog({
        userId: session.user.userId,
        action: "DISMISS_CANDIDATE",
        entityType: "DiscoveredAITool",
        entityId: id,
        changes: { toolName: tool.toolName, reason },
      });

      return NextResponse.json({ dismissed: true });
    }

    // Handle promote to registered system
    if (body.action === "register" || body.action === "register_and_assess") {
      const tool = await prisma.discoveredAITool.findUnique({ where: { id } });
      if (!tool) return NextResponse.json({ error: "Not found" }, { status: 404 });

      // Attempt AI-assisted classification so the new governed system starts
      // with sensible defaults (use case, model type, data inputs/outputs,
      // risk level, sensitivity). Best-effort: returns null on failure or
      // when the AI provider isn't configured; we fall back to plain defaults.
      const enrichment = await classifyDiscoveredTool({
        toolName: tool.toolName,
        vendor: tool.vendor,
        detectedDomain: tool.detectedDomain,
        department: tool.department,
        notes: tool.notes,
      });

      const fallbackDescription =
        `Registered from shadow AI discovery. ${tool.notes ?? ""}`.trim();

      const system = await prisma.aISystem.create({
        data: {
          name: tool.toolName,
          description: enrichment?.description ?? fallbackDescription,
          useCase: enrichment?.useCase ?? null,
          modelType: enrichment?.modelType ?? null,
          dataInputs: enrichment?.dataInputs ?? null,
          dataOutputs: enrichment?.dataOutputs ?? null,
          department: tool.department ?? "Unknown",
          vendor: tool.vendor,
          ownerId: session.user.userId,
          status: "UNDER_REVIEW",
          riskLevel: enrichment?.riskLevel ?? "MEDIUM",
          dataSensitivity: enrichment?.dataSensitivity ?? "INTERNAL",
        },
      });

      await prisma.discoveredAITool.update({
        where: { id },
        data: { status: "REGISTERED", linkedSystemId: system.id },
      });

      await createAuditLog({
        userId: session.user.userId,
        action: "REGISTER",
        entityType: "DiscoveredAITool",
        entityId: id,
        aiSystemId: system.id,
        changes: enrichment
          ? {
              aiAssisted: true,
              inferredFields: Object.keys(enrichment).filter((k) => k !== "reasoning"),
              reasoning: enrichment.reasoning ?? null,
            }
          : { aiAssisted: false },
      });

      return NextResponse.json({
        system,
        tool: { id, status: "REGISTERED", linkedSystemId: system.id },
        aiAssisted: !!enrichment,
        nextHref:
          body.action === "register_and_assess"
            ? `/risk-center/assessments/new?systemId=${system.id}`
            : `/registry/${system.id}`,
      });
    }

    // Regular status update
    const parsed = updateDiscoveredToolSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const updated = await prisma.discoveredAITool.update({
      where: { id },
      data: {
        status: parsed.data.status,
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      },
    });

    return NextResponse.json(updated);
  });
}
