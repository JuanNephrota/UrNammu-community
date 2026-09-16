import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { z } from "zod";
import { createAuditLog } from "@/lib/audit";
import { findMatchingGovernedSystem } from "@/lib/governed-system-match";
import { normalizeDirectoryEmail, rollupDepartments } from "@/lib/directory-identity";

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
    const confidence = req.nextUrl.searchParams.get("confidence");

    const where: Record<string, unknown> = {};
    if (!includeSuppressed) where.linkedSystemId = null;
    if (confidence && ["high", "medium", "low"].includes(confidence)) {
      where.matchConfidence = confidence;
    }

    const tools = await prisma.discoveredAITool.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { detectedAt: "desc" },
      include: { _count: { select: { alerts: true } } },
    });

    // Department rollup of each tool's observed users, from the synced
    // identity-provider directory (DirectoryPerson). One lookup for every
    // email across all tools; tools with no matches get an empty rollup.
    const observedEmails = [
      ...new Set(
        tools
          .flatMap((tool) => tool.userEmails)
          .map((email) => normalizeDirectoryEmail(email))
          .filter((email): email is string => !!email)
      ),
    ];
    const people =
      observedEmails.length > 0
        ? await prisma.directoryPerson.findMany({
            where: {
              OR: [{ primaryEmail: { in: observedEmails } }, { aliases: { hasSome: observedEmails } }],
            },
            select: { primaryEmail: true, aliases: true, department: true, active: true },
          })
        : [];

    return NextResponse.json(
      tools.map((tool) => ({
        ...tool,
        departmentRollup:
          tool.userEmails.length > 0 && people.length > 0
            ? rollupDepartments(tool.userEmails, people)
            : null,
      }))
    );
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
