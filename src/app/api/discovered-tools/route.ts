import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { z } from "zod";
import { createAuditLog } from "@/lib/audit";
import { findMatchingGovernedSystem } from "@/lib/governed-system-match";

const createDiscoveredToolSchema = z.object({
  toolName: z.string().min(1),
  vendor: z.string().optional(),
  detectedDomain: z.string().optional(),
  detectionSource: z.string().default("manual"),
  department: z.string().optional(),
  userCount: z.number().int().min(0).default(0),
  notes: z.string().optional(),
});

export async function GET(req: NextRequest) {
  return withAuth(async () => {
    // Discoveries that match a governed AISystem are suppressed by default so
    // they do not clutter the shadow-AI queue. Pass ?includeSuppressed=true to
    // surface them (e.g. for admin debugging or audit exports).
    const includeSuppressed =
      req.nextUrl.searchParams.get("includeSuppressed") === "true";
    const tools = await prisma.discoveredAITool.findMany({
      where: includeSuppressed ? undefined : { linkedSystemId: null },
      orderBy: { detectedAt: "desc" },
      include: { _count: { select: { alerts: true } } },
    });
    return NextResponse.json(tools);
  });
}

export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const body = await req.json();
    const parsed = createDiscoveredToolSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }

    const governedMatch = await findMatchingGovernedSystem({
      toolName: parsed.data.toolName,
      vendor: parsed.data.vendor,
      detectedDomain: parsed.data.detectedDomain,
    });

    const tool = await prisma.discoveredAITool.create({
      data: governedMatch
        ? {
            ...parsed.data,
            status: "REGISTERED",
            linkedSystemId: governedMatch.id,
            notes: parsed.data.notes
              ? `${parsed.data.notes}\nSuppressed: matches governed system "${governedMatch.name}".`
              : `Suppressed: matches governed system "${governedMatch.name}".`,
          }
        : parsed.data,
    });

    // Only alert on genuinely new shadow AI — suppress when the tool is
    // already registered as a governed AISystem.
    if (!governedMatch) {
      await prisma.alert.create({
        data: {
          title: `New AI tool discovered: ${tool.toolName}`,
          description: `${tool.toolName} was detected via ${tool.detectionSource}${tool.department ? ` in ${tool.department}` : ""}`,
          severity: "MEDIUM",
          source: "shadow_ai",
          relatedToolId: tool.id,
        },
      });
    }

    await createAuditLog({
      userId: session.user.userId,
      action: "CREATE",
      entityType: "DiscoveredAITool",
      entityId: tool.id,
    });

    return NextResponse.json(tool, { status: 201 });
  });
}
