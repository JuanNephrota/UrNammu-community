import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { updateKeyUsageRuleSchema } from "@/lib/validations/key-usage-rule";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const body = await req.json();
    const parsed = updateKeyUsageRuleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = await prisma.keyUsageRule.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    // conditionType is immutable, so a submitted config must match the shape
    // the rule already declares.
    if (
      parsed.data.config &&
      parsed.data.config.conditionType !== existing.conditionType
    ) {
      return NextResponse.json(
        {
          error: `This rule's condition is ${existing.conditionType} and cannot be changed. Create a new rule for a different condition.`,
        },
        { status: 400 }
      );
    }

    const rule = await prisma.keyUsageRule.update({
      where: { id },
      data: {
        ...(parsed.data.label !== undefined && { label: parsed.data.label }),
        ...(parsed.data.description !== undefined && {
          description: parsed.data.description,
        }),
        ...(parsed.data.severity !== undefined && { severity: parsed.data.severity }),
        ...(parsed.data.config !== undefined && { config: parsed.data.config }),
        ...(parsed.data.providers !== undefined && { providers: parsed.data.providers }),
        ...(parsed.data.apiKeyExternalIds !== undefined && {
          apiKeyExternalIds: parsed.data.apiKeyExternalIds,
        }),
        ...(parsed.data.enabled !== undefined && { enabled: parsed.data.enabled }),
      },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "UPDATE",
      entityType: "KeyUsageRule",
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
    const existing = await prisma.keyUsageRule.findUnique({ where: { id } });
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

    await prisma.keyUsageRule.delete({ where: { id } });

    await createAuditLog({
      userId: session.user.userId,
      action: "DELETE",
      entityType: "KeyUsageRule",
      entityId: id,
      changes: { key: existing.key, label: existing.label },
    });

    return NextResponse.json({ success: true });
  });
}
