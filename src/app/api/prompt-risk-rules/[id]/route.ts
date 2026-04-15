import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { invalidateRuleCache } from "@/lib/prompt-risk";
import { validateRegexPatterns } from "@/lib/regex-validator";
import { z } from "zod";

const SEVERITY = ["critical", "warning"] as const;

// Note: `key` and `builtIn` are not editable. Key is the stable identifier
// referenced by PromptRiskException rows; builtIn is set by migrations.
const updateRuleSchema = z
  .object({
    label: z.string().min(1).max(200).optional(),
    severity: z.enum(SEVERITY).optional(),
    patterns: z.array(z.string().min(1)).min(1).max(10).optional(),
    description: z.string().max(2000).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "At least one field must be provided.",
  });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const body = await req.json();
    const parsed = updateRuleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    if (parsed.data.patterns) {
      const regexCheck = validateRegexPatterns(parsed.data.patterns);
      if (!regexCheck.ok) {
        return NextResponse.json({ error: regexCheck.error }, { status: 400 });
      }
    }

    const existing = await prisma.promptRiskRule.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    const rule = await prisma.promptRiskRule.update({
      where: { id },
      data: {
        ...(parsed.data.label !== undefined && { label: parsed.data.label }),
        ...(parsed.data.severity !== undefined && { severity: parsed.data.severity }),
        ...(parsed.data.patterns !== undefined && { patterns: parsed.data.patterns }),
        ...(parsed.data.description !== undefined && {
          description: parsed.data.description,
        }),
        ...(parsed.data.enabled !== undefined && { enabled: parsed.data.enabled }),
      },
    });

    invalidateRuleCache();

    await createAuditLog({
      userId: session.user.userId,
      action: "UPDATE",
      entityType: "PromptRiskRule",
      entityId: rule.id,
      changes: JSON.parse(JSON.stringify(parsed.data)),
    });

    return NextResponse.json(rule);
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const existing = await prisma.promptRiskRule.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }
    if (existing.builtIn) {
      return NextResponse.json(
        {
          error:
            "Built-in rules cannot be deleted. Disable them or use the reset endpoint to restore defaults.",
        },
        { status: 400 }
      );
    }

    await prisma.promptRiskRule.delete({ where: { id } });
    invalidateRuleCache();

    await createAuditLog({
      userId: session.user.userId,
      action: "DELETE",
      entityType: "PromptRiskRule",
      entityId: id,
      changes: { key: existing.key, label: existing.label },
    });

    return NextResponse.json({ success: true });
  });
}
