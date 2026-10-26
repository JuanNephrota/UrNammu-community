import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { updateNetworkRuleSchema } from "@/lib/validations/network-rule";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = updateNetworkRuleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const existing = await prisma.networkBlockRule.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    try {
      const rule = await prisma.networkBlockRule.update({
        where: { id },
        data: {
          ...(parsed.data.pattern !== undefined ? { pattern: parsed.data.pattern.toLowerCase() } : {}),
          ...(parsed.data.action !== undefined ? { action: parsed.data.action } : {}),
          ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
          ...(parsed.data.reason !== undefined ? { reason: parsed.data.reason || null } : {}),
        },
      });
      await createAuditLog({
        userId: session.user.userId,
        action: "UPDATE",
        entityType: "NetworkBlockRule",
        entityId: id,
        changes: {
          before: { pattern: existing.pattern, action: existing.action, enabled: existing.enabled, reason: existing.reason },
          after: { pattern: rule.pattern, action: rule.action, enabled: rule.enabled, reason: rule.reason },
        },
      });
      return NextResponse.json(rule);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return NextResponse.json({ error: "A rule with this pattern and action already exists." }, { status: 409 });
      }
      throw err;
    }
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const existing = await prisma.networkBlockRule.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await prisma.networkBlockRule.delete({ where: { id } });
    await createAuditLog({
      userId: session.user.userId,
      action: "DELETE",
      entityType: "NetworkBlockRule",
      entityId: id,
      changes: { pattern: existing.pattern, action: existing.action, reason: existing.reason },
    });
    return NextResponse.json({ ok: true });
  });
}
