import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { encryptSettingValue, isSecretSetting } from "@/lib/settings-crypto";
import { logger } from "@/lib/observability";
import { z } from "zod";

// GET: Fetch settings (admin-only, masks sensitive values)
export async function GET() {
  return withRole(["ADMIN"], async () => {
    const settings = await prisma.appSetting.findMany();

    // Mask sensitive values
    const masked = settings.map((s) => ({
      key: s.key,
      value: isSecretSetting(s.key)
        ? s.value ? "Encrypted" : null
        : s.value,
      hasValue: !!s.value,
      updatedAt: s.updatedAt,
    }));

    return NextResponse.json(masked);
  });
}

const updateSettingsSchema = z.record(z.string(), z.union([z.string(), z.null()]));

// PUT: Update settings (admin-only)
export async function PUT(req: NextRequest) {
  return withRole(["ADMIN"], async (session) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = updateSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid settings format", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const updates = parsed.data;
    const changedKeys: string[] = [];

    try {
      await prisma.$transaction(async (tx) => {
        for (const [key, value] of Object.entries(updates)) {
          if (value === null || value === "") {
            await tx.appSetting.deleteMany({ where: { key } });
            changedKeys.push(key);
          } else {
            const storedValue = encryptSettingValue(key, value);
            await tx.appSetting.upsert({
              where: { key },
              update: { value: storedValue },
              create: { key, value: storedValue },
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
        }, tx);
      });

      logger.info("settings.updated", {
        userId: session.user.userId,
        keys: changedKeys,
      });

      return NextResponse.json({ success: true, updated: changedKeys });
    } catch (err) {
      logger.error("settings.update_failed", {
        userId: session.user.userId,
        error: err instanceof Error ? err.message : "Database error",
      });
      return NextResponse.json(
        { error: `Failed to save: ${err instanceof Error ? err.message : "Database error"}` },
        { status: 500 }
      );
    }
  });
}
