import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { invalidateRuleCache } from "@/lib/prompt-risk";

/**
 * Restore a built-in rule to its original seeded definition.
 * Non-builtIn rules reject with 400 — they have no default to restore to.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const existing = await prisma.promptRiskRule.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }
    if (!existing.builtIn) {
      return NextResponse.json(
        { error: "Only built-in rules can be reset to defaults." },
        { status: 400 }
      );
    }
    if (!existing.defaultLabel || !existing.defaultSeverity || existing.defaultPatterns.length === 0) {
      return NextResponse.json(
        { error: "This rule has no stored default snapshot." },
        { status: 500 }
      );
    }

    const rule = await prisma.promptRiskRule.update({
      where: { id },
      data: {
        label: existing.defaultLabel,
        severity: existing.defaultSeverity,
        patterns: existing.defaultPatterns,
        enabled: true,
      },
    });

    invalidateRuleCache();

    await createAuditLog({
      userId: session.user.userId,
      action: "RESET",
      entityType: "PromptRiskRule",
      entityId: rule.id,
      changes: { key: rule.key, restoredToDefaults: true },
    });

    return NextResponse.json(rule);
  });
}
