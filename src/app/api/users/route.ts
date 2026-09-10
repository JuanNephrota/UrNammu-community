import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/passwords";
import { createAuditLog } from "@/lib/audit";
import { managedUserSelect, serializeManagedUser } from "@/lib/user-lifecycle";

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(120),
  role: z.enum(["ADMIN", "COMPLIANCE_OFFICER", "VIEWER"]),
  department: z.string().trim().max(120).optional().nullable(),
  password: z.string().min(8).max(200).optional().nullable(),
});

export async function GET(req: NextRequest) {
  return withRole(["ADMIN"], async () => {
    // Retired accounts stay in the table forever to keep the audit trail
    // attributable, so keep them out of the directory unless asked for.
    const includeDeleted = req.nextUrl.searchParams.get("includeDeleted") === "true";

    const users = await prisma.user.findMany({
      where: includeDeleted ? undefined : { status: { not: "DELETED" } },
      orderBy: { createdAt: "desc" },
      select: managedUserSelect,
    });

    return NextResponse.json(users.map(serializeManagedUser));
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
        select: managedUserSelect,
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

      return NextResponse.json(serializeManagedUser(user), { status: 201 });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to create user" },
        { status: 500 }
      );
    }
  });
}
