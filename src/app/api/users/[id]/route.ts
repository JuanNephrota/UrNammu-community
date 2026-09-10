import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/passwords";
import { createAuditLog } from "@/lib/audit";
import { managedUserSelect, retireUser, serializeManagedUser } from "@/lib/user-lifecycle";

const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(["ADMIN", "COMPLIANCE_OFFICER", "VIEWER"]).optional(),
  department: z.string().trim().max(120).nullable().optional(),
  password: z.string().min(8).max(200).nullable().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  statusReason: z.string().trim().max(500).nullable().optional(),
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

    // Blocking self-service here is what keeps at least one active admin in the
    // workspace: the caller is necessarily an active admin, so any account they
    // suspend, demote, or delete is never the last one standing.
    const isSelf = id === session.user.userId;
    if (isSelf && parsed.data.role && parsed.data.role !== session.user.role) {
      return NextResponse.json(
        { error: "You cannot change your own role from this screen." },
        { status: 400 }
      );
    }
    if (isSelf && parsed.data.status && parsed.data.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "You cannot suspend your own account." },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({
      where: { id },
      select: managedUserSelect,
    });

    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (existing.status === "DELETED") {
      return NextResponse.json(
        { error: "This account has been deleted and can no longer be edited." },
        { status: 409 }
      );
    }

    const updateData: {
      name?: string;
      role?: "ADMIN" | "COMPLIANCE_OFFICER" | "VIEWER";
      department?: string | null;
      passwordHash?: string | null;
      status?: "ACTIVE" | "SUSPENDED";
      statusReason?: string | null;
      suspendedAt?: Date | null;
    } = {};

    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.role !== undefined) updateData.role = parsed.data.role;
    if (parsed.data.department !== undefined) updateData.department = parsed.data.department || null;
    if (parsed.data.password !== undefined) {
      updateData.passwordHash = parsed.data.password
        ? await hashPassword(parsed.data.password)
        : null;
    }
    if (parsed.data.status !== undefined) {
      updateData.status = parsed.data.status;
      if (parsed.data.status === "SUSPENDED") {
        updateData.suspendedAt = existing.suspendedAt ?? new Date();
        updateData.statusReason = parsed.data.statusReason ?? null;
      } else {
        updateData.suspendedAt = null;
        updateData.statusReason = null;
      }
    } else if (parsed.data.statusReason !== undefined) {
      updateData.statusReason = parsed.data.statusReason || null;
    }

    const suspending =
      parsed.data.status === "SUSPENDED" && existing.status !== "SUSPENDED";

    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: updateData,
        select: managedUserSelect,
      });

      // JWT sessions are revoked on the next request by the status re-read in
      // hydrateJwtClaims; clearing database sessions covers adapter sessions too.
      if (suspending) {
        await tx.session.deleteMany({ where: { userId: id } });
      }

      return updated;
    });

    await createAuditLog({
      userId: session.user.userId,
      action: suspending
        ? "SUSPEND"
        : parsed.data.status === "ACTIVE" && existing.status === "SUSPENDED"
          ? "REACTIVATE"
          : "UPDATE",
      entityType: "User",
      entityId: user.id,
      changes: {
        before: {
          name: existing.name,
          role: existing.role,
          department: existing.department,
          status: existing.status,
          hasLocalPassword: !!existing.passwordHash,
        },
        after: {
          name: user.name,
          role: user.role,
          department: user.department,
          status: user.status,
          statusReason: user.statusReason,
          hasLocalPassword: !!user.passwordHash,
        },
      },
    });

    return NextResponse.json(serializeManagedUser(user));
  });
}

const deleteUserSchema = z.object({
  reason: z.string().trim().max(500).nullable().optional(),
});

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN"], async (session) => {
    const { id } = await params;

    if (id === session.user.userId) {
      return NextResponse.json(
        { error: "You cannot delete your own account." },
        { status: 400 }
      );
    }

    // A body is optional on DELETE.
    let reason: string | null = null;
    const rawBody = await req.text();
    if (rawBody) {
      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }
      const parsed = deleteUserSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten() },
          { status: 400 }
        );
      }
      reason = parsed.data.reason?.trim() || null;
    }

    const existing = await prisma.user.findUnique({
      where: { id },
      select: managedUserSelect,
    });

    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (existing.status === "DELETED") {
      return NextResponse.json(
        { error: "This account has already been deleted." },
        { status: 409 }
      );
    }

    const user = await retireUser(id, reason);

    // Record the original identity here: it is the only place the mapping from
    // the anonymized row back to the real person survives.
    await createAuditLog({
      userId: session.user.userId,
      action: "DELETE",
      entityType: "User",
      entityId: user.id,
      changes: {
        before: {
          name: existing.name,
          email: existing.email,
          role: existing.role,
          department: existing.department,
          status: existing.status,
          authProviders: existing.accounts.map((account) => account.provider),
        },
        after: {
          status: user.status,
          deletedAt: user.deletedAt,
          reason,
        },
      },
    });

    return NextResponse.json(serializeManagedUser(user));
  });
}
