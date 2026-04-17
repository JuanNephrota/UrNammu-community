import { NextResponse } from "next/server";
import { FORGE_SETTINGS_KEYS, getSetting } from "@/lib/settings";
import { syncForgeSkills } from "@/lib/forge-skills-sync";

/**
 * Scheduled Forge AI Skills sync. Hit by Vercel Cron via vercel.json.
 * Guarded by `Authorization: Bearer $CRON_SECRET`, matching the existing
 * /api/scheduler/maintenance cron convention.
 *
 * No-ops when `forge_sync_enabled` is unset/false — so the default posture
 * is quiet: the cron fires but doesn't actually do anything until an admin
 * opts in via Settings.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const enabled = await getSetting(FORGE_SETTINGS_KEYS.SYNC_ENABLED);
  if (enabled !== "true") {
    return NextResponse.json({ skipped: true, reason: "sync disabled" });
  }

  const result = await syncForgeSkills({ trigger: "cron" });
  return NextResponse.json(result, {
    status: result.status === "succeeded" ? 200 : 502,
  });
}
