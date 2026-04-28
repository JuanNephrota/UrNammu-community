import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { withAuth, withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { upsertVendorProfileSchema } from "@/lib/validations/vendor-profile";

export async function GET() {
  return withAuth(async () => {
    const profiles = await prisma.vendorProfile.findMany({
      orderBy: { vendor: "asc" },
    });
    return NextResponse.json(profiles);
  });
}

export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const body = await req.json();
    const parsed = upsertVendorProfileSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const startDate = parsed.data.contractStartDate
      ? new Date(parsed.data.contractStartDate)
      : null;

    const renewalDate = parsed.data.contractRenewalDate
      ? new Date(parsed.data.contractRenewalDate)
      : null;

    if (
      startDate &&
      Number.isNaN(startDate.getTime())
    ) {
      return NextResponse.json(
        { error: "Invalid contract start date" },
        { status: 400 }
      );
    }

    if (
      renewalDate &&
      Number.isNaN(renewalDate.getTime())
    ) {
      return NextResponse.json(
        { error: "Invalid contract renewal date" },
        { status: 400 }
      );
    }

    const profile = await prisma.vendorProfile.upsert({
      where: { vendor: parsed.data.vendor },
      update: {
        contractStatus: parsed.data.contractStatus,
        contractOwner: parsed.data.contractOwner || null,
        contractStartDate: startDate,
        contractRenewalDate: renewalDate,
        renewalNoticeDays: parsed.data.renewalNoticeDays,
        renewalNotes: parsed.data.renewalNotes || null,
        securityReviewStatus: parsed.data.securityReviewStatus,
        dataResidency: parsed.data.dataResidency as Prisma.InputJsonValue,
        approvedUseCases: parsed.data.approvedUseCases as Prisma.InputJsonValue,
        subprocessors: parsed.data.subprocessors as Prisma.InputJsonValue,
        notes: parsed.data.notes || null,
      },
      create: {
        vendor: parsed.data.vendor,
        contractStatus: parsed.data.contractStatus,
        contractOwner: parsed.data.contractOwner || null,
        contractStartDate: startDate,
        contractRenewalDate: renewalDate,
        renewalNoticeDays: parsed.data.renewalNoticeDays,
        renewalNotes: parsed.data.renewalNotes || null,
        securityReviewStatus: parsed.data.securityReviewStatus,
        dataResidency: parsed.data.dataResidency as Prisma.InputJsonValue,
        approvedUseCases: parsed.data.approvedUseCases as Prisma.InputJsonValue,
        subprocessors: parsed.data.subprocessors as Prisma.InputJsonValue,
        notes: parsed.data.notes || null,
      },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "UPSERT",
      entityType: "VendorProfile",
      entityId: profile.id,
    });

    return NextResponse.json(profile, { status: 201 });
  });
}
