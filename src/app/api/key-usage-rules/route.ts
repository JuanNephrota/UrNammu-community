import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { createKeyUsageRuleSchema } from "@/lib/validations/key-usage-rule";

export async function GET() {
  return withAuth(async () => {
    const rules = await prisma.keyUsageRule.findMany({
      orderBy: [{ builtIn: "desc" }, { key: "asc" }],
    });
    return NextResponse.json(rules);
  });
}

export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const body = await req.json();
    const parsed = createKeyUsageRuleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = await prisma.keyUsageRule.findUnique({
      where: { key: parsed.data.key },
    });
    if (existing) {
      return NextResponse.json(
        { error: `A rule with key "${parsed.data.key}" already exists.` },
        { status: 409 }
      );
    }

    const rule = await prisma.keyUsageRule.create({
      data: {
        key: parsed.data.key,
        label: parsed.data.label,
        description: parsed.data.description ?? null,
        conditionType: parsed.data.conditionType,
        severity: parsed.data.severity,
        providers: parsed.data.providers ?? [],
        apiKeyExternalIds: parsed.data.apiKeyExternalIds ?? [],
        config: parsed.data.config,
        enabled: parsed.data.enabled ?? true,
        builtIn: false,
      },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "CREATE",
      entityType: "KeyUsageRule",
      entityId: rule.id,
      changes: {
        key: rule.key,
        label: rule.label,
        conditionType: rule.conditionType,
        severity: rule.severity,
      },
    });

    return NextResponse.json(rule, { status: 201 });
  });
}
