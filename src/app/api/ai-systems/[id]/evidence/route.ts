import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";

const evidenceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100),
  content: z.string().trim().optional(),
  linkUrl: z.string().url().optional().or(z.literal("")),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const body = await req.json();
    const parsed = evidenceSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const system = await prisma.aISystem.findUnique({ where: { id } });
    if (!system) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const artifact = await prisma.$transaction(async (tx) => {
      const created = await tx.evidenceArtifact.create({
        data: {
          aiSystemId: id,
          uploadedByUserId: session.user.userId,
          title: parsed.data.title,
          category: parsed.data.category,
          content: parsed.data.content || null,
          linkUrl: parsed.data.linkUrl || null,
        },
        include: { uploadedByUser: { select: { name: true, email: true } } },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.userId,
          action: "CREATE",
          entityType: "EvidenceArtifact",
          entityId: created.id,
          aiSystemId: id,
          changes: { title: created.title, category: created.category },
        },
      });

      return created;
    });

    return NextResponse.json(artifact, { status: 201 });
  });
}
