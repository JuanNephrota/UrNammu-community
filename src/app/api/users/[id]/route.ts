import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/passwords";
import { createAuditLog } from "@/lib/audit";

const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(["ADMIN", "COMPLIANCE_OFFICER", "VIEWER"]).optional(),
  department: z.string().trim().max(120).nullable().optional(),
  password: z.string().min(8).max(200).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN"], async (session) => {
    const { id } = await params;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    if (id === session.user.userId && parsed.data.role && parsed.data.role !== session.user.role) {
      return NextResponse.json(
        { error: "You cannot change your own role from this screen." },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({
      where: { id },
      include: { accounts: { select: { provider: true } } },
    });

    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const updateData: {
      name?: string;
      role?: "ADMIN" | "COMPLIANCE_OFFICER" | "VIEWER";
      department?: string | null;
      passwordHash?: string | null;
    } = {};

    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.role !== undefined) updateData.role = parsed.data.role;
    if (parsed.data.department !== undefined) updateData.department = parsed.data.department || null;
    if (parsed.data.password !== undefined) {
      updateData.passwordHash = parsed.data.password
        ? await hashPassword(parsed.data.password)
        : null;
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      include: { accounts: { select: { provider: true } } },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "UPDATE",
      entityType: "User",
      entityId: user.id,
      changes: {
        before: {
          name: existing.name,
          role: existing.role,
          department: existing.department,
          hasLocalPassword: !!existing.passwordHash,
        },
        after: {
          name: user.name,
          role: user.role,
          department: user.department,
          hasLocalPassword: !!user.passwordHash,
        },
      },
    });

    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department,
      createdAt: user.createdAt,
      hasLocalPassword: !!user.passwordHash,
      authProviders: user.accounts.map((account) => account.provider),
    });
  });
}
