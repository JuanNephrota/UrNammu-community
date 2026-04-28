import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/passwords";
import { createAuditLog } from "@/lib/audit";

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(120),
  role: z.enum(["ADMIN", "COMPLIANCE_OFFICER", "VIEWER"]),
  department: z.string().trim().max(120).optional().nullable(),
  password: z.string().min(8).max(200).optional().nullable(),
});

export async function GET() {
  return withRole(["ADMIN"], async () => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        accounts: {
          select: { provider: true },
        },
      },
    });

    return NextResponse.json(
      users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        createdAt: user.createdAt,
        hasLocalPassword: !!user.passwordHash,
        authProviders: user.accounts.map((account) => account.provider),
      }))
    );
  });
}

export async function POST(req: NextRequest) {
  return withRole(["ADMIN"], async (session) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const passwordHash = parsed.data.password
      ? await hashPassword(parsed.data.password)
      : null;

    try {
      const user = await prisma.user.create({
        data: {
          email: parsed.data.email,
          name: parsed.data.name,
          role: parsed.data.role,
          department: parsed.data.department || null,
          passwordHash,
        },
      });

      await createAuditLog({
        userId: session.user.userId,
        action: "CREATE",
        entityType: "User",
        entityId: user.id,
        changes: {
          email: user.email,
          role: user.role,
          department: user.department,
          hasLocalPassword: !!passwordHash,
        },
      });

      return NextResponse.json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        hasLocalPassword: !!user.passwordHash,
        authProviders: [],
      }, { status: 201 });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to create user" },
        { status: 500 }
      );
    }
  });
}
