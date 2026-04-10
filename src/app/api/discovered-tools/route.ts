import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { z } from "zod";
import { createAuditLog } from "@/lib/audit";

const createDiscoveredToolSchema = z.object({
  toolName: z.string().min(1),
  vendor: z.string().optional(),
  detectedDomain: z.string().optional(),
  detectionSource: z.string().default("manual"),
  department: z.string().optional(),
  userCount: z.number().int().min(0).default(0),
  notes: z.string().optional(),
});

export async function GET() {
  return withAuth(async () => {
    const tools = await prisma.discoveredAITool.findMany({
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

    const tool = await prisma.discoveredAITool.create({ data: parsed.data });

    // Auto-create alert for new discovery
    await prisma.alert.create({
      data: {
        title: `New AI tool discovered: ${tool.toolName}`,
        description: `${tool.toolName} was detected via ${tool.detectionSource}${tool.department ? ` in ${tool.department}` : ""}`,
        severity: "MEDIUM",
        source: "shadow_ai",
        relatedToolId: tool.id,
      },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "CREATE",
      entityType: "DiscoveredAITool",
      entityId: tool.id,
    });

    return NextResponse.json(tool, { status: 201 });
  });
}
