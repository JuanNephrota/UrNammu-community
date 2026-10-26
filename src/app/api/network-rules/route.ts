import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { createNetworkRuleSchema } from "@/lib/validations/network-rule";

/**
 * URL block rules for the general network proxy (`/api/proxy/net/…`).
 * Both proxies re-read the enabled rules every 30 s, so a change here takes
 * effect within that window.
 */
export async function GET() {
  return withAuth(async () => {
    const rules = await prisma.networkBlockRule.findMany({
      orderBy: [{ action: "asc" }, { createdAt: "asc" }],
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });
    return NextResponse.json(rules);
  });
}

export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = createNetworkRuleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    try {
      const rule = await prisma.networkBlockRule.create({
        data: {
          pattern: parsed.data.pattern.toLowerCase(),
          action: parsed.data.action,
          enabled: parsed.data.enabled,
          reason: parsed.data.reason || null,
          createdById: session.user.userId,
        },
      });
      await createAuditLog({
        userId: session.user.userId,
        action: "CREATE",
        entityType: "NetworkBlockRule",
        entityId: rule.id,
        changes: { pattern: rule.pattern, action: rule.action, enabled: rule.enabled, reason: rule.reason },
      });
      return NextResponse.json(rule, { status: 201 });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return NextResponse.json({ error: "A rule with this pattern and action already exists." }, { status: 409 });
      }
      throw err;
    }
  });
}
