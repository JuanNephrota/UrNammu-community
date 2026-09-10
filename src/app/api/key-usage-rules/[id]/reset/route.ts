import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";

/**
 * Restore a built-in rule to its seeded definition. Non-builtIn rules reject
 * with 400 — they have no default to restore to.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const existing = await prisma.keyUsageRule.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }
    if (!existing.builtIn) {
      return NextResponse.json(
        { error: "Only built-in rules can be reset to defaults." },
        { status: 400 }
      );
    }
    if (!existing.defaultLabel || !existing.defaultSeverity || !existing.defaultConfig) {
      return NextResponse.json(
        { error: "This rule has no stored default snapshot." },
        { status: 500 }
      );
    }

    const rule = await prisma.keyUsageRule.update({
      where: { id },
      data: {
        label: existing.defaultLabel,
        severity: existing.defaultSeverity,
        config: existing.defaultConfig,
        providers: [],
        apiKeyExternalIds: [],
        // `enabled` is deliberately left as-is. Reset restores the rule's
        // definition, not its on/off state — flipping a rule an admin had
        // switched off back on would be a surprising side effect, and
        // key_model_allowlist ships disabled on purpose.
      },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "RESET",
      entityType: "KeyUsageRule",
      entityId: rule.id,
      changes: { key: rule.key, restoredToDefaults: true },
    });

    return NextResponse.json(rule);
  });
}
