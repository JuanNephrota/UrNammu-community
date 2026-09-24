import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { patchVendorProfileSchema } from "@/lib/validations/vendor-profile";

// Saves one wizard step's fields. Only keys present in the body are written.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const parsed = patchVendorProfileSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = await prisma.vendorProfile.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { dataResidency, subprocessors, approvedUseCases, ...scalars } = parsed.data;
    const data: Prisma.VendorProfileUpdateInput = { ...scalars };
    if (dataResidency !== undefined) data.dataResidency = dataResidency;
    if (subprocessors !== undefined) data.subprocessors = subprocessors;
    if (approvedUseCases !== undefined) data.approvedUseCases = approvedUseCases;

    const profile = await prisma.vendorProfile.update({ where: { id }, data });

    await createAuditLog({
      userId: session.user.userId,
      action: "UPDATE",
      entityType: "VendorProfile",
      entityId: id,
      changes: { fields: Object.keys(parsed.data) },
    });

    return NextResponse.json(profile);
  });
}
