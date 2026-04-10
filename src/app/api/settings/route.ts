import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

// GET: Fetch settings (admin-only, masks sensitive values)
export async function GET() {
  return withRole(["ADMIN"], async () => {
    const settings = await prisma.appSetting.findMany();

    // Mask sensitive values
    const masked = settings.map((s) => ({
      key: s.key,
      value: s.key.includes("key") || s.key.includes("secret")
        ? s.value ? "••••••••" + s.value.slice(-8) : null
        : s.value,
      hasValue: !!s.value,
      updatedAt: s.updatedAt,
    }));

    return NextResponse.json(masked);
  });
}

const updateSettingsSchema = z.record(z.string(), z.string().nullable());

// PUT: Update settings (admin-only)
export async function PUT(req: NextRequest) {
  return withRole(["ADMIN"], async (session) => {
    const body = await req.json();
    const parsed = updateSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid settings format" }, { status: 400 });
    }

    const updates = parsed.data;
    const changedKeys: string[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") {
        // Delete setting
        await prisma.appSetting.deleteMany({ where: { key } });
        changedKeys.push(key);
      } else {
        // Upsert setting
        await prisma.appSetting.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        });
        changedKeys.push(key);
      }
    }

    await createAuditLog({
      userId: session.user.userId,
      action: "UPDATE",
      entityType: "AppSettings",
      entityId: "global",
      changes: JSON.parse(JSON.stringify({ keys: changedKeys })),
    });

    return NextResponse.json({ success: true, updated: changedKeys });
  });
}
