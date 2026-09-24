import { NextRequest, NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { onboardVendorSchema } from "@/lib/validations/vendor-profile";

// Step 1 of the Add vendor wizard. Unlike POST /api/vendor-profiles (a full
// upsert), this never overwrites an existing profile: if the vendor already
// has one (matched case-insensitively), it is returned so the wizard can
// resume it instead.
export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const parsed = onboardVendorSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = await prisma.vendorProfile.findFirst({
      where: { vendor: { equals: parsed.data.vendor, mode: "insensitive" } },
      select: { id: true, vendor: true },
    });
    if (existing) {
      return NextResponse.json({ id: existing.id, vendor: existing.vendor, created: false });
    }

    // Reuse the exact spelling already used by systems or discoveries so the
    // profile lines up with them on the vendor governance page.
    const [system, discovery] = await Promise.all([
      prisma.aISystem.findFirst({
        where: { vendor: { equals: parsed.data.vendor, mode: "insensitive" } },
        select: { vendor: true },
      }),
      prisma.discoveredAITool.findFirst({
        where: { vendor: { equals: parsed.data.vendor, mode: "insensitive" } },
        select: { vendor: true },
      }),
    ]);
    const vendor = system?.vendor ?? discovery?.vendor ?? parsed.data.vendor;

    const profile = await prisma.vendorProfile.create({
      data: {
        vendor,
        website: parsed.data.website,
        description: parsed.data.description,
        contractOwner: parsed.data.contractOwner,
      },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "CREATE",
      entityType: "VendorProfile",
      entityId: profile.id,
      changes: { vendor, source: "onboarding_wizard" },
    });

    return NextResponse.json({ id: profile.id, vendor: profile.vendor, created: true }, { status: 201 });
  });
}
