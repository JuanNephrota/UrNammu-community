import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const VALID_CATEGORIES = [
  "prompt_injection",
  "secret_extraction",
  "data_exfiltration",
  "malware_or_phishing",
  "dangerous_autonomy",
  "sensitive_data_in_prompt",
] as const;

const createExceptionSchema = z.object({
  category: z.enum(VALID_CATEGORIES),
  pattern: z.string().min(1).max(500).optional(),
  reason: z.string().min(1).max(2000),
  expiresAt: z.string().datetime().optional(),
});

export async function GET() {
  return withAuth(async () => {
    const exceptions = await prisma.promptRiskException.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        createdByUser: { select: { name: true, email: true } },
        sourceAlert: { select: { id: true, title: true } },
      },
    });
    return NextResponse.json(exceptions);
  });
}

export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const body = await req.json();
    const parsed = createExceptionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const exception = await prisma.promptRiskException.create({
      data: {
        category: parsed.data.category,
        pattern: parsed.data.pattern ?? null,
        reason: parsed.data.reason,
        createdByUserId: session.user.userId,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "CREATE",
      entityType: "PromptRiskException",
      entityId: exception.id,
      changes: { category: parsed.data.category, pattern: parsed.data.pattern },
    });

    return NextResponse.json(exception, { status: 201 });
  });
}
