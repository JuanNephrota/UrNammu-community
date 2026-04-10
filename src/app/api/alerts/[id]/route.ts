import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async () => {
    const { id } = await params;
    const body = await req.json();
    const alert = await prisma.alert.update({
      where: { id },
      data: { status: body.status },
    });
    return NextResponse.json(alert);
  });
}
